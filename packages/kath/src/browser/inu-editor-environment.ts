import { inject, injectable } from 'inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { InuBreakpointManager } from './inu-breakpoint-manager';
import { InuProjectService } from '../common/inu-protocol';

/**
 * Keeps Kath aligned with the operating-system colour scheme and
 * supplies built-in C# lexical syntax highlighting without requiring the
 * VS Code/Open VSX plugin runtime.
 */
@injectable()
export class InuEditorEnvironmentContribution implements FrontendApplicationContribution {
    @inject(ThemeService)
    protected readonly themeService!: ThemeService;

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    @inject(InuBreakpointManager)
    protected readonly breakpointManager!: InuBreakpointManager;

    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    @inject(OutputChannelManager)
    protected readonly outputChannelManager!: OutputChannelManager;

    @inject(InuProjectService)
    protected readonly projectService!: InuProjectService;

    protected systemThemeQuery: MediaQueryList | undefined;
    protected systemThemeChangeListener: ((event: MediaQueryListEvent) => void) | undefined;
    protected documentContextMenuListener: ((event: MouseEvent) => void) | undefined;
    protected sdkCompletionProvider: monaco.IDisposable | undefined;
    protected readonly sdkEditorDisposables = new Map<string, monaco.IDisposable[]>();
    protected readonly sdkSyncTimers = new Map<string, number>();
    protected readonly sdkApplyingImports = new Set<string>();

    async onStart(): Promise<void> {
        this.installCSharpSyntaxHighlighting();
        this.installSdkReferenceIntelligence();

        await this.preferences.ready;
        await this.themeService.initialized;

        // Follow the host operating-system appearance rather than forcing one
        // Inu colour scheme. This is deliberately non-persistent: changing the
        // Windows/macOS/Linux theme updates the IDE live without overwriting a stored
        // Theia preference.
        this.systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.applySystemTheme(this.systemThemeQuery.matches);
        this.systemThemeChangeListener = event => this.applySystemTheme(event.matches);
        this.systemThemeQuery.addEventListener('change', this.systemThemeChangeListener);

        this.installBreakpointInteraction();

        const channel = this.outputChannelManager.getChannel('Inu Build');
        channel.appendLine('[INFO] Breakpoint UI ready: Theia native debugger owns gutter breakpoints/F9; Inu Debug -> Toggle Breakpoint is bridged to the same breakpoint manager.');
    }

    protected applySystemTheme(dark: boolean): void {
        // persist=false keeps the IDE synchronized to the host operating-system theme
        // without replacing any user preference on disk.
        this.themeService.setCurrentTheme(dark ? 'dark' : 'light', false);
    }

    onStop(): void {
        if (this.systemThemeQuery && this.systemThemeChangeListener) {
            this.systemThemeQuery.removeEventListener('change', this.systemThemeChangeListener);
        }
        this.systemThemeChangeListener = undefined;
        this.systemThemeQuery = undefined;
        if (this.documentContextMenuListener) {
            document.removeEventListener('contextmenu', this.documentContextMenuListener, true);
            this.documentContextMenuListener = undefined;
        }
        this.sdkCompletionProvider?.dispose();
        this.sdkCompletionProvider = undefined;
        for (const disposables of this.sdkEditorDisposables.values()) for (const disposable of disposables) disposable.dispose();
        this.sdkEditorDisposables.clear();
        for (const timer of this.sdkSyncTimers.values()) window.clearTimeout(timer);
        this.sdkSyncTimers.clear();
    }

    protected installCSharpSyntaxHighlighting(): void {
        if (!monaco.languages.getLanguages().some(language => language.id === 'csharp')) {
            monaco.languages.register({
                id: 'csharp',
                extensions: ['.cs'],
                aliases: ['C#', 'CSharp', 'csharp'],
                mimetypes: ['text/x-csharp']
            });
        }

        monaco.languages.setLanguageConfiguration('csharp', {
            comments: { lineComment: '//', blockComment: ['/*', '*/'] },
            brackets: [['{', '}'], ['[', ']'], ['(', ')']],
            autoClosingPairs: [
                { open: '{', close: '}' },
                { open: '[', close: ']' },
                { open: '(', close: ')' },
                { open: '"', close: '"' },
                { open: "'", close: "'" }
            ],
            surroundingPairs: [
                { open: '{', close: '}' },
                { open: '[', close: ']' },
                { open: '(', close: ')' },
                { open: '"', close: '"' },
                { open: "'", close: "'" }
            ]
        });

        monaco.languages.setMonarchTokensProvider('csharp', {
            defaultToken: '',
            tokenPostfix: '.cs',
            keywords: [
                'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char',
                'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do',
                'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false', 'finally',
                'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int',
                'interface', 'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null',
                'object', 'operator', 'out', 'override', 'params', 'private', 'protected',
                'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short', 'sizeof',
                'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true',
                'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using',
                'virtual', 'void', 'volatile', 'while', 'record', 'init', 'required', 'file',
                'scoped', 'nint', 'nuint', 'global', 'when', 'where', 'yield', 'async', 'await'
            ],
            typeKeywords: [
                'Boolean', 'Byte', 'Char', 'Decimal', 'Double', 'Int16', 'Int32', 'Int64',
                'Object', 'SByte', 'Single', 'String', 'UInt16', 'UInt32', 'UInt64'
            ],
            operators: [
                '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||',
                '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>',
                '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '??',
                '??=', '=>', '?.', '?[]'
            ],
            symbols: /[=><!~?:&|+\-*\/\^%]+/,
            escapes: /\\(?:[abfnrtv\\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
            tokenizer: {
                root: [
                    [/[a-zA-Z_$][\w$]*/, {
                        cases: {
                            '@keywords': 'keyword',
                            '@typeKeywords': 'type',
                            '@default': 'identifier'
                        }
                    }],
                    { include: '@whitespace' },
                    [/\d*\.\d+([eE][\-+]?\d+)?[fFdDmM]?/, 'number.float'],
                    [/0[xX][0-9a-fA-F_]+[uUlL]*/, 'number.hex'],
                    [/0[bB][01_]+[uUlL]*/, 'number.binary'],
                    [/\d[\d_]*[uUlLfFdDmM]*/, 'number'],
                    [/[{}()\[\]]/, '@brackets'],
                    [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
                    [/[@$]?\"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
                    [/'([^'\\]|\\.)'/, 'string'],
                    [/[;,.]/, 'delimiter']
                ],
                whitespace: [
                    [/[ \t\r\n]+/, 'white'],
                    [/\/\*/, 'comment', '@comment'],
                    [/\/\/.*/, 'comment']
                ],
                comment: [
                    [/[^/*]+/, 'comment'],
                    [/\/\*/, 'comment', '@push'],
                    [/\*\//, 'comment', '@pop'],
                    [/[/*]/, 'comment']
                ],
                string: [
                    [/[^\\\"]+/, 'string'],
                    [/@escapes/, 'string.escape'],
                    [/\\./, 'string.escape.invalid'],
                    [/\"/, { token: 'string.quote', bracket: '@close', next: '@pop' }]
                ]
            }
        });
    }

    protected installSdkReferenceIntelligence(): void {
        this.sdkCompletionProvider = monaco.languages.registerCompletionItemProvider('csharp', {
            provideCompletionItems: async (model, position) => {
                const word = model.getWordUntilPosition(position);
                const prefix = word.word;
                if (prefix.length < 2) return { suggestions: [] };
                const symbols = await this.projectService.listSdkReferenceSymbols(prefix);
                const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
                return {
                    suggestions: symbols.map(symbol => ({
                        label: symbol.name,
                        kind: monaco.languages.CompletionItemKind.Class,
                        insertText: symbol.name,
                        range,
                        detail: `${symbol.namespace} — ${symbol.project} (Inu central SDK reference)`,
                        documentation: `Kath will reference ${symbol.assembly} from Inu when this symbol is used; the DLL and source remain outside the generated OS unless explicitly materialised.`
                    }))
                };
            }
        });

        const attachAll = () => {
            for (const editor of MonacoEditor.getAll(this.editorManager)) this.attachSdkReferenceSynchronization(editor);
        };
        attachAll();
        this.editorManager.onCreated(() => window.setTimeout(attachAll, 0));
        this.editorManager.onCurrentEditorChanged(() => window.setTimeout(attachAll, 0));
    }

    protected attachSdkReferenceSynchronization(editor: MonacoEditor): void {
        const sourcePath = editor.uri.path.fsPath();
        if (!sourcePath.toLowerCase().endsWith('.cs') || this.sdkEditorDisposables.has(sourcePath.toLowerCase())) return;
        const control = editor.getControl();
        const key = sourcePath.toLowerCase();
        const change = control.onDidChangeModelContent(() => {
            if (this.sdkApplyingImports.has(key)) return;
            const existing = this.sdkSyncTimers.get(key);
            if (existing !== undefined) window.clearTimeout(existing);
            this.sdkSyncTimers.set(key, window.setTimeout(() => void this.synchronizeSdkReferences(editor), 450));
        });
        const dispose = control.onDidDispose(() => {
            const timer = this.sdkSyncTimers.get(key);
            if (timer !== undefined) window.clearTimeout(timer);
            this.sdkSyncTimers.delete(key);
            const entries = this.sdkEditorDisposables.get(key) ?? [];
            for (const item of entries) if (item !== dispose) item.dispose();
            this.sdkEditorDisposables.delete(key);
        });
        this.sdkEditorDisposables.set(key, [change, dispose]);
        void this.synchronizeSdkReferences(editor);
    }

    protected async synchronizeSdkReferences(editor: MonacoEditor): Promise<void> {
        const sourcePath = editor.uri.path.fsPath();
        const key = sourcePath.toLowerCase();
        const model = editor.getControl().getModel();
        if (!model || !sourcePath.toLowerCase().endsWith('.cs')) return;
        const result = await this.projectService.synchronizeSdkReferences(sourcePath, model.getValue());
        if (!result.success || result.namespaces.length === 0) return;
        const text = model.getValue();
        const missing = result.namespaces.filter(namespace => !new RegExp(`^\\s*using\\s+${namespace.replace(/\./g, '\\.')}\\s*;`, 'm').test(text));
        if (missing.length === 0) return;
        this.sdkApplyingImports.add(key);
        try {
            const lines = text.split(/\r?\n/);
            let insertAfter = 0;
            for (let index = 0; index < lines.length; index++) {
                if (/^\s*using\s+[A-Za-z_][A-Za-z0-9_.]*\s*;/.test(lines[index])) insertAfter = index + 1;
                else if (insertAfter > 0 && lines[index].trim() !== '') break;
            }
            const line = insertAfter > 0 ? insertAfter + 1 : 1;
            const value = missing.map(namespace => `using ${namespace};`).join('\n') + '\n';
            editor.getControl().executeEdits('inu-sdk-reference-resolver', [{ range: new monaco.Range(line, 1, line, 1), text: value, forceMoveMarkers: true }]);
        } finally {
            this.sdkApplyingImports.delete(key);
        }
    }

    protected installBreakpointInteraction(): void {
        // Theia's @theia/debug package is the authoritative breakpoint editor UI.
        // It installs the Monaco gutter handler, F9 command, persistent source
        // breakpoint manager and decorations. Inu only tracks the precise
        // right-click location for its Debug -> Toggle Breakpoint submenu.
        const enableGlyphMargin = () => {
            for (const editor of MonacoEditor.getAll(this.editorManager)) {
                editor.getControl().updateOptions({ glyphMargin: true });
            }
        };

        enableGlyphMargin();
        this.editorManager.onCreated(() => window.setTimeout(enableGlyphMargin, 0));
        this.editorManager.onCurrentEditorChanged(() => window.setTimeout(enableGlyphMargin, 0));

        this.documentContextMenuListener = event => {
            const location = this.sourceLocationAtClientPoint(event.clientX, event.clientY, event.target);
            if (location) {
                this.breakpointManager.setContextLocation(location.sourcePath, location.line);
            }
        };
        document.addEventListener('contextmenu', this.documentContextMenuListener, true);
    }

    protected sourceLocationAtClientPoint(clientX: number, clientY: number, domTarget: EventTarget | null):
        { sourcePath: string; line: number } | undefined {
        const node = domTarget instanceof Node ? domTarget : undefined;
        for (const editor of MonacoEditor.getAll(this.editorManager)) {
            if (node && !editor.node.contains(node)) {
                continue;
            }
            const sourcePath = editor.uri.path.fsPath();
            if (!sourcePath.toLowerCase().endsWith('.cs')) {
                continue;
            }
            const target = editor.getControl().getTargetAtClientPoint(clientX, clientY);
            const line = target?.position?.lineNumber ?? target?.range?.startLineNumber;
            if (line && line > 0) {
                return { sourcePath, line };
            }
        }
        return undefined;
    }

}
