import { inject, injectable } from 'inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { InuBreakpointManager } from './inu-breakpoint-manager';

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

    protected systemThemeQuery: MediaQueryList | undefined;
    protected systemThemeChangeListener: ((event: MediaQueryListEvent) => void) | undefined;
    protected documentContextMenuListener: ((event: MouseEvent) => void) | undefined;

    async onStart(): Promise<void> {
        this.installCSharpSyntaxHighlighting();

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
