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
import { InuProblemsWidget, InuProblem } from './inu-problems-widget';

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

    @inject(InuProblemsWidget)
    protected readonly problemsWidget!: InuProblemsWidget;

    protected systemThemeQuery: MediaQueryList | undefined;
    protected systemThemeChangeListener: ((event: MediaQueryListEvent) => void) | undefined;
    protected documentContextMenuListener: ((event: MouseEvent) => void) | undefined;
    protected sdkCompletionProvider: monaco.IDisposable | undefined;
    protected sdkCodeActionProvider: monaco.IDisposable | undefined;
    protected readonly sdkEditorDisposables = new Map<string, monaco.IDisposable[]>();
    protected readonly sdkSyncTimers = new Map<string, number>();
    protected readonly sdkApplyingImports = new Set<string>();
    protected readonly csharpSlashDecorations = new Map<string, string[]>();

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
        this.sdkCodeActionProvider?.dispose();
        this.sdkCodeActionProvider = undefined;
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

        this.sdkCodeActionProvider = monaco.languages.registerCodeActionProvider('csharp', {
            provideCodeActions: (model, _range, context) => {
                const actions: monaco.languages.CodeAction[] = [];
                for (const diagnostic of context.markers) {
                    if (String(diagnostic.code ?? '') !== 'INU1009') continue;
                    const match = /Add using ([A-Za-z_][A-Za-z0-9_.]*);/.exec(diagnostic.message);
                    if (!match) continue;
                    const namespace = match[1];
                    const text = model.getValue();
                    if (new RegExp(`^\\s*using\\s+${namespace.replace(/\./g, '\\.')}\\s*;`, 'm').test(text)) continue;
                    const lines = text.split(/\r?\n/);
                    let insertAfter = 0;
                    for (let index = 0; index < lines.length; index++) {
                        if (/^\s*using\s+[A-Za-z_][A-Za-z0-9_.]*\s*;/.test(lines[index])) insertAfter = index + 1;
                        else if (insertAfter > 0 && lines[index].trim() !== '') break;
                    }
                    const line = insertAfter > 0 ? insertAfter + 1 : 1;
                    actions.push({
                        title: `Add using ${namespace};`,
                        kind: 'quickfix',
                        isPreferred: true,
                        diagnostics: [diagnostic],
                        edit: {
                            edits: [{
                                resource: model.uri,
                                versionId: model.getVersionId(),
                                textEdit: { range: new monaco.Range(line, 1, line, 1), text: `using ${namespace};\n` }
                            }]
                        }
                    });
                }
                return { actions, dispose: () => undefined };
            }
        });

        const attachAll = () => {
            for (const editor of MonacoEditor.getAll(this.editorManager)) this.attachSdkReferenceSynchronization(editor);
        };
        // Restored editor tabs are created asynchronously by Theia. Scan now and again while
        // the workbench restores so every already-open C# model receives diagnostics without
        // requiring focus, an edit, Save, Build or Run.
        attachAll();
        for (const delay of [0, 75, 250, 750]) window.setTimeout(attachAll, delay);
        this.editorManager.onCreated(() => window.setTimeout(attachAll, 0));
        this.editorManager.onCurrentEditorChanged(() => window.setTimeout(attachAll, 0));
    }

    protected attachSdkReferenceSynchronization(editor: MonacoEditor): void {
        const sourcePath = editor.uri.path.fsPath();
        if (!sourcePath.toLowerCase().endsWith('.cs') || this.sdkEditorDisposables.has(sourcePath.toLowerCase())) return;
        const control = editor.getControl();
        const key = sourcePath.toLowerCase();
        const change = control.onDidChangeModelContent(() => {
            this.updateCSharpSlashDiagnostics(editor);
            this.updateInuPathPolicyDiagnostics(editor);
            this.publishLiveDiagnostics(editor);
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
            this.csharpSlashDecorations.delete(key);
            this.problemsWidget.clearLiveProblems(sourcePath);
        });
        this.sdkEditorDisposables.set(key, [change, dispose]);
        this.updateCSharpSlashDiagnostics(editor);
        this.updateInuPathPolicyDiagnostics(editor);
        this.publishLiveDiagnostics(editor);
        void this.synchronizeSdkReferences(editor);
    }

    protected publishLiveDiagnostics(editor: MonacoEditor): void {
        const sourcePath = editor.uri.path.fsPath();
        const model = editor.getControl().getModel();
        if (!model || !sourcePath.toLowerCase().endsWith('.cs')) return;
        const diagnostics: InuProblem[] = monaco.editor.getModelMarkers({ resource: model.uri })
            .filter(marker => marker.owner === 'kath-csharp-syntax' || marker.owner === 'kath-inu-policy' || marker.owner === 'kath-inu-usings')
            .map(marker => ({
                severity: marker.severity === monaco.MarkerSeverity.Warning ? 'warning' : 'error',
                filePath: sourcePath,
                line: marker.startLineNumber,
                column: marker.startColumn,
                code: typeof marker.code === 'string' ? marker.code : marker.code?.value,
                message: marker.message
            }));
        this.problemsWidget.setLiveProblems(sourcePath, diagnostics);
    }


    protected updateCSharpSlashDiagnostics(editor: MonacoEditor): void {
        const sourcePath = editor.uri.path.fsPath();
        if (!sourcePath.toLowerCase().endsWith('.cs')) return;
        const control = editor.getControl();
        const model = control.getModel();
        if (!model) return;
        const owner = 'kath-csharp-syntax';
        const markers: monaco.editor.IMarkerData[] = [];
        const decorations: monaco.editor.IModelDeltaDecoration[] = [];
        for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber++) {
            const text = model.getLineContent(lineNumber);
            const first = text.search(/\S/);
            if (first < 0 || text[first] !== '/') continue;
            const next = text[first + 1] ?? '';
            // A slash at the start of a C# statement is almost always a mistyped
            // comment opener. Do not flag valid //, /* or /= tokens, and do not
            // flag division operators that occur after another token on the line.
            if (next === '/' || next === '*' || next === '=') continue;
            markers.push({
                severity: monaco.MarkerSeverity.Error,
                message: "Unexpected '/'. Use '//' for a single-line comment or '/* ... */' for a block comment.",
                startLineNumber: lineNumber,
                startColumn: first + 1,
                endLineNumber: lineNumber,
                endColumn: Math.min(text.length + 1, first + 2)
            });
            decorations.push({
                range: new monaco.Range(lineNumber, 1, lineNumber, Math.max(1, text.length + 1)),
                options: { isWholeLine: true, className: 'inu-csharp-error-line', overviewRuler: { color: '#d13438', position: monaco.editor.OverviewRulerLane.Right } }
            });
        }

        // Catch ordinary C# string/character escape mistakes immediately. Monaco's lexical
        // grammar can colour an invalid escape, but it does not create a Problems diagnostic.
        // This lightweight scanner is intentionally syntax-only and therefore needs no build.
        const source = model.getValue();
        let inBlockComment = false;
        for (let i = 0; i < source.length; i++) {
            const c = source[i], next = source[i + 1] ?? '';
            if (inBlockComment) { if (c === '*' && next === '/') { inBlockComment = false; i++; } continue; }
            if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
            if (c === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
            const verbatim = c === '@' && next === '"';
            if (verbatim || c === '"' || c === "'") {
                const quote = verbatim ? '"' : c;
                if (verbatim) i++;
                for (i++; i < source.length; i++) {
                    const q = source[i];
                    if (q === '\n' || q === '\r') break;
                    if (verbatim) {
                        if (q === '"' && source[i + 1] === '"') { i++; continue; }
                        if (q === '"') break;
                        continue;
                    }
                    if (q === quote) break;
                    if (q !== '\\') continue;
                    const escapeIndex = i;
                    const e = source[i + 1] ?? '';
                    const simple = "'\"\\0abfnrtv".includes(e);
                    if (simple) { i++; continue; }
                    let digits = 0;
                    if (e === 'x') { let j = i + 2; while (j < source.length && digits < 4 && /[0-9A-Fa-f]/.test(source[j])) { digits++; j++; } if (digits > 0) { i = j - 1; continue; } }
                    if (e === 'u' || e === 'U') { const needed = e === 'u' ? 4 : 8; let j = i + 2; while (j < source.length && digits < needed && /[0-9A-Fa-f]/.test(source[j])) { digits++; j++; } if (digits === needed) { i = j - 1; continue; } }
                    const start = model.getPositionAt(escapeIndex);
                    const end = model.getPositionAt(Math.min(source.length, escapeIndex + Math.max(2, e ? 2 : 1)));
                    markers.push({
                        severity: monaco.MarkerSeverity.Error,
                        code: 'CS1009',
                        message: 'Unrecognized escape sequence.',
                        startLineNumber: start.lineNumber,
                        startColumn: start.column,
                        endLineNumber: end.lineNumber,
                        endColumn: end.column
                    });
                    if (e) i++;
                }
            }
        }
        monaco.editor.setModelMarkers(model, owner, markers);
        const key = sourcePath.toLowerCase();
        const old = this.csharpSlashDecorations.get(key) ?? [];
        this.csharpSlashDecorations.set(key, control.deltaDecorations(old, decorations));
    }

    protected maskCSharpComments(source: string, maskStrings = false): string {
        const chars = source.split('');
        let state: 'code' | 'line' | 'block' | 'string' | 'verbatim' | 'char' = 'code';
        let escape = false;
        for (let i = 0; i < chars.length; i++) {
            const c = source[i], next = source[i + 1] ?? '';
            const mask = () => { if (chars[i] !== '\r' && chars[i] !== '\n') chars[i] = ' '; };
            if (state === 'line') { mask(); if (c === '\n') state = 'code'; continue; }
            if (state === 'block') { mask(); if (c === '*' && next === '/') { if (i + 1 < chars.length) chars[i + 1] = ' '; i++; state = 'code'; } continue; }
            if (state === 'string') {
                if (maskStrings) mask();
                if (escape) { escape = false; continue; }
                if (c === '\\') { escape = true; continue; }
                if (c === '"') state = 'code';
                continue;
            }
            if (state === 'verbatim') {
                if (maskStrings) mask();
                if (c === '"' && next === '"') { if (maskStrings && i + 1 < chars.length) chars[i + 1] = ' '; i++; continue; }
                if (c === '"') state = 'code';
                continue;
            }
            if (state === 'char') {
                if (maskStrings) mask();
                if (escape) { escape = false; continue; }
                if (c === '\\') { escape = true; continue; }
                if (c === '\'') state = 'code';
                continue;
            }
            if (c === '/' && next === '/') { mask(); if (i + 1 < chars.length) chars[i + 1] = ' '; i++; state = 'line'; continue; }
            if (c === '/' && next === '*') { mask(); if (i + 1 < chars.length) chars[i + 1] = ' '; i++; state = 'block'; continue; }
            if (c === '@' && next === '"') { if (maskStrings) { mask(); chars[i + 1] = ' '; } i++; state = 'verbatim'; continue; }
            if (c === '"') { if (maskStrings) mask(); state = 'string'; continue; }
            if (c === '\'') { if (maskStrings) mask(); state = 'char'; continue; }
        }
        return chars.join('');
    }

    protected operatingSystemSourceRoot(sourcePath: string): string {
        const normalized = sourcePath.replace(/\\/g, '/');
        const lower = normalized.toLowerCase();
        const indexes = ['/kernel/', '/userland/', '/boot/'].map(token => lower.indexOf(token)).filter(index => index >= 0);
        const cut = indexes.length > 0 ? Math.min(...indexes) : normalized.lastIndexOf('/');
        return (cut >= 0 ? normalized.substring(0, cut) : normalized).toLowerCase();
    }

    protected updateInuPathPolicyDiagnostics(editor: MonacoEditor): void {
        const sourcePath = editor.uri.path.fsPath();
        if (!sourcePath.toLowerCase().endsWith('.cs')) return;
        const root = this.operatingSystemSourceRoot(sourcePath);
        const scans = MonacoEditor.getAll(this.editorManager)
            .filter(candidate => candidate.uri.path.fsPath().toLowerCase().endsWith('.cs') && this.operatingSystemSourceRoot(candidate.uri.path.fsPath()) === root)
            .map(candidate => {
                const model = candidate.getControl().getModel();
                const text = model?.getValue() ?? '';
                return { editor: candidate, model, text, active: this.maskCSharpComments(text) };
            })
            .filter(scan => !!scan.model);

        type SeparatorCall = { scan: typeof scans[number]; index: number; separator: string; sourceLength: number; source: 'kernel' | 'userland' };
        const calls: SeparatorCall[] = [];
        const decode = (token: string) => token === '\\\\' ? '\\' : token === "\\'" ? "'" : token;
        for (const scan of scans) {
            const patterns: Array<{ source: 'kernel' | 'userland'; regex: RegExp }> = [
                { source: 'kernel', regex: /\bFileSystem\.SetPathPolicy\s*\(\s*new\s+FileSystemPathPolicy\s*\(\s*'(\\.|[^'\\])'/g },
                { source: 'userland', regex: /\bFileSystemPaths\.SetPathSeparator\s*\(\s*'(\\.|[^'\\])'\s*\)/g }
            ];
            for (const pattern of patterns) {
                let match: RegExpExecArray | null;
                while ((match = pattern.regex.exec(scan.active))) {
                    const token = match[1], separator = decode(token);
                    const literalOffset = match[0].indexOf(`'${token}'`);
                    if (separator.length === 1 && literalOffset >= 0) calls.push({ scan, index: match.index + literalOffset + 1, separator, sourceLength: token.length, source: pattern.source });
                }
            }
        }
        const kernel = calls.filter(call => call.source === 'kernel');
        const selected = (kernel.length > 0 ? kernel[kernel.length - 1] : calls[calls.length - 1])?.separator;

        for (const scan of scans) {
            const model = scan.model!;
            const markers: monaco.editor.IMarkerData[] = [];
            const addMarker = (absoluteIndex: number, sourceLength: number, code: string, message: string): void => {
                const start = model.getPositionAt(absoluteIndex);
                const end = model.getPositionAt(absoluteIndex + Math.max(1, sourceLength));
                markers.push({ severity: monaco.MarkerSeverity.Error, code, message, startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column });
            };
            if (selected) {
                for (const call of calls.filter(item => item.scan === scan && item.separator !== selected)) {
                    addMarker(call.index, call.sourceLength, 'INU1008', `This active path-separator policy selects '${call.separator}', but the kernel path policy selects '${selected}'. Change the live setting to '${selected}'.`);
                }
                const inspectLiteral = (raw: string, absoluteStart: number): void => {
                    const verbatim = raw.startsWith('@"');
                    const bodyStart = verbatim ? 2 : 1, bodyEnd = raw.length - 1;
                    for (let i = bodyStart; i < bodyEnd; i++) {
                        let value = raw[i], sourceLength = 1;
                        if (!verbatim && value === '\\' && i + 1 < bodyEnd) {
                            if (raw[i + 1] === '\\') { value = '\\'; sourceLength = 2; }
                            else { i++; continue; }
                        } else if (verbatim && value === '"' && raw[i + 1] === '"') { i++; continue; }
                        const code = value.length === 1 ? value.charCodeAt(0) : 0;
                        const filenameFriendly = /[A-Za-z0-9._ -]/.test(value);
                        const placeholderDelimiter = value === '{' || value === '}';
                        const separatorLike = code > 0 && code <= 0x7f && !filenameFriendly && !placeholderDelimiter;
                        if (separatorLike && value !== selected) {
                            const shown = value === '\\' ? '\\\\' : value;
                            addMarker(absoluteStart + i, sourceLength, 'INU1007', `Path uses '${shown}' but the active kernel path separator is '${selected}'.`);
                            if (sourceLength === 2) i++;
                        }
                    }
                };
                const literalPattern = /@"(?:[^"]|"")*"|"(?:\\.|[^"\\])*"/g;
                const callPatterns = [
                    /\bFileSystemPaths\.SetCommandsPaths\s*\(\s*new\s*\[\s*\]\s*\{([\s\S]*?)\}\s*\)/g,
                    /\bFileSystemPaths\.SetCommandsPath\s*\(\s*(@"(?:[^"]|"")*"|"(?:\\.|[^"\\])*")\s*\)/g,
                    /\bFileSystem\.SetLogicalPath\s*\([^,]+,\s*(@"(?:[^"]|"")*"|"(?:\\.|[^"\\])*")\s*\)/g
                ];
                for (const pattern of callPatterns) {
                    let match: RegExpExecArray | null;
                    while ((match = pattern.exec(scan.active))) {
                        const body = match[1];
                        const bodyStart = match.index + match[0].indexOf(body);
                        let literal: RegExpExecArray | null;
                        literalPattern.lastIndex = 0;
                        while ((literal = literalPattern.exec(body))) inspectLiteral(literal[0], bodyStart + literal.index);
                    }
                }
            }
            monaco.editor.setModelMarkers(model, 'kath-inu-policy', markers);
            this.publishLiveDiagnostics(scan.editor);
        }
    }

    protected async synchronizeSdkReferences(editor: MonacoEditor): Promise<void> {
        const sourcePath = editor.uri.path.fsPath();
        const model = editor.getControl().getModel();
        if (!model || !sourcePath.toLowerCase().endsWith('.cs')) return;
        const result = await this.projectService.synchronizeSdkReferences(sourcePath, model.getValue());
        const markers: monaco.editor.IMarkerData[] = [];
        if (result.success) {
            const clean = this.maskCSharpComments(model.getValue(), true);
            for (const missing of result.missingUsings ?? []) {
                const pattern = new RegExp(`\\b${missing.symbol.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'g');
                let match: RegExpExecArray | null;
                while ((match = pattern.exec(clean))) {
                    const previous = match.index > 0 ? clean[match.index - 1] : '';
                    if (previous === '.') continue;
                    const start = model.getPositionAt(match.index);
                    const end = model.getPositionAt(match.index + missing.symbol.length);
                    markers.push({
                        severity: monaco.MarkerSeverity.Error,
                        code: 'INU1009',
                        message: `The Inu SDK symbol '${missing.symbol}' is declared in namespace '${missing.namespace}'. Add using ${missing.namespace};`,
                        startLineNumber: start.lineNumber,
                        startColumn: start.column,
                        endLineNumber: end.lineNumber,
                        endColumn: end.column
                    });
                }
            }
        }
        monaco.editor.setModelMarkers(model, 'kath-inu-usings', markers);
        this.publishLiveDiagnostics(editor);
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
