import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { MessageService } from '@theia/core/lib/common';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuDebugCommand, InuDebugState, InuProjectService, InuRunMode } from '../common/inu-protocol';
import { InuBreakpointManager } from './inu-breakpoint-manager';
import { InuDebugInspectorWidget } from './inu-debug-inspector-widget';
import { InuKernelConsoleWidget } from './inu-kernel-console-widget';
import { InuProblemsWidget } from './inu-problems-widget';

const RUN_MODE_STORAGE_KEY = 'inu.ide.runMode';
const RUN_MODE_CHANGED_EVENT = 'inu-run-mode-changed';
const OUTPUT_CHANNEL_NAME = 'Inu Build';

@injectable()
export class InuToolbarWidget extends ReactWidget {
    static readonly ID = 'inu.run.toolbar';

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    @inject(InuProjectService)
    protected readonly projectService!: InuProjectService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(OutputChannelManager)
    protected readonly outputChannelManager!: OutputChannelManager;

    @inject(InuBreakpointManager)
    protected readonly breakpointManager!: InuBreakpointManager;

    @inject(InuDebugInspectorWidget)
    protected readonly debugInspector!: InuDebugInspectorWidget;

    @inject(InuKernelConsoleWidget)
    protected readonly kernelConsole!: InuKernelConsoleWidget;

    @inject(InuProblemsWidget)
    protected readonly problemsWidget!: InuProblemsWidget;

    protected runMode: InuRunMode = 'run';
    protected launching = false;
    protected sessionId: string | undefined;
    protected runButtonLocked = false;
    protected runButtonUnlockTimer: number | undefined;
    protected stopRequested = false;
    protected cancelPendingSession = false;
    protected debugState: InuDebugState = { active: false, paused: false, sourceSymbols: false };
    protected lastRevealedStop = '';
    protected breakpointsArmedForSession: string | undefined;
    protected readonly pausedDecorations = new Map<MonacoEditor, string[]>();

    @postConstruct()
    protected init(): void {
        this.id = InuToolbarWidget.ID;
        this.addClass('inu-run-toolbar-widget');

        const stored = window.localStorage.getItem(RUN_MODE_STORAGE_KEY);
        this.runMode = stored === 'debug' ? 'debug' : 'run';
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => this.update()));
        this.toDispose.push(this.editorManager.onCurrentEditorChanged(() => this.update()));
        this.toDispose.push(this.breakpointManager.onDidChange(() => this.update()));
        this.update();
    }

    refresh(): void {
        this.update();
    }

    async run(mode: InuRunMode): Promise<void> {
        this.setRunMode(mode);
        await this.runCurrentOperatingSystem();
    }

    protected async revealProblems(): Promise<void> {
        if (!this.problemsWidget.isAttached) {
            await this.shell.addWidget(this.problemsWidget, { area: 'bottom', rank: 10 });
        }
        this.shell.bottomPanel.show();
        await this.shell.activateWidget(this.problemsWidget.id);
    }

    protected render(): React.ReactNode {
        const hasWorkspace = !!this.currentProjectPath();
        const debug = this.runMode === 'debug';
        const active = debug && this.debugState.active && !!this.sessionId;
        const paused = active && this.debugState.paused;
        const canSetBreakpoint = debug && hasWorkspace;
        const runActive = this.launching || !!this.sessionId;
        const stopAvailable = runActive && !this.runButtonLocked && !this.stopRequested;
        const runLabel = this.stopRequested
            ? 'Stopping…'
            : runActive
                ? (this.runButtonLocked ? 'Starting…' : 'Stop Run')
                : 'Run';
        const runTitle = !hasWorkspace
            ? 'Open a Inu OS first'
            : stopAvailable
                ? 'Cancel the current Inu build/run session'
                : runActive
                    ? 'Run is starting; Stop Run becomes available after two seconds'
                    : `Run current Inu OS (${debug ? 'Debug' : 'No Debug'})`;
        return <div className='inu-run-toolbar'>
            <button
                className={`theia-button inu-run-button${stopAvailable ? ' stop-run' : ''}`}
                disabled={!hasWorkspace || this.runButtonLocked || this.stopRequested}
                title={runTitle}
                onClick={() => runActive ? this.stopCurrentOperatingSystem() : this.runCurrentOperatingSystem()}
            >
                <span className={`codicon ${stopAvailable ? 'codicon-debug-stop' : 'codicon-play'}`} aria-hidden='true'></span>
                <span>{runLabel}</span>
            </button>
            <select
                className='theia-select inu-run-mode'
                value={this.runMode}
                disabled={this.launching || !!this.sessionId}
                aria-label='Inu run mode'
                title='Inu run mode'
                onChange={event => this.setRunMode(event.target.value as InuRunMode)}
            >
                <option value='run'>No Debug</option>
                <option value='debug'>Debug</option>
            </select>
            {debug && <div className='inu-debug-controls' aria-label='Inu debugger controls'>
                <button className='inu-debug-button inu-breakpoint-button' disabled={!canSetBreakpoint} title='Toggle breakpoint on the current source line (also click the far-left editor gutter)' onClick={() => this.toggleBreakpoint()}>
                    <span className='codicon codicon-debug-breakpoint' aria-hidden='true'></span>
                </button>
                <span className='inu-debug-separator'></span>
                <button className='inu-debug-button' disabled={!hasWorkspace} title='Show Exception Breakpoints, Watch, Memory, Page Tables, Kernel Heap, Crash Dumps, Mixed Disassembly, Named Locals/Arguments, Call Stack and Registers' onClick={() => this.showDebugInspector()}>
                    <span className='codicon codicon-debug-alt' aria-hidden='true'></span>
                </button>
                <span className='inu-debug-separator'></span>
                <button className='inu-debug-button' disabled={!paused} title='Continue (F5)' onClick={() => this.sendDebugCommand('continue')}>
                    <span className='codicon codicon-debug-continue' aria-hidden='true'></span>
                </button>
                <button className='inu-debug-button' disabled={!active || paused} title='Pause' onClick={() => this.sendDebugCommand('pause')}>
                    <span className='codicon codicon-debug-pause' aria-hidden='true'></span>
                </button>
                <button className='inu-debug-button' disabled={!paused} title='Step Over (F10)' onClick={() => this.sendDebugCommand('step-over')}>
                    <span className='codicon codicon-debug-step-over' aria-hidden='true'></span>
                </button>
                <button className='inu-debug-button' disabled={!paused} title='Step Into (F11)' onClick={() => this.sendDebugCommand('step-into')}>
                    <span className='codicon codicon-debug-step-into' aria-hidden='true'></span>
                </button>
                <button className='inu-debug-button' disabled={!paused} title='Step Out (Shift+F11)' onClick={() => this.sendDebugCommand('step-out')}>
                    <span className='codicon codicon-debug-step-out' aria-hidden='true'></span>
                </button>
                <button className='inu-debug-button' disabled={!active} title='Restart' onClick={() => this.sendDebugCommand('restart')}>
                    <span className='codicon codicon-debug-restart' aria-hidden='true'></span>
                </button>
                <button className='inu-debug-button' disabled={!active} title='Stop (Shift+F5)' onClick={() => this.sendDebugCommand('stop')}>
                    <span className='codicon codicon-debug-stop' aria-hidden='true'></span>
                </button>
                <span className={`inu-debug-state ${paused ? 'paused' : active ? 'running' : ''}`} title={this.debugState.message ?? 'Debugger not attached'}>
                    {paused ? 'Paused' : active ? 'Running' : this.launching ? 'Attaching…' : debug && hasWorkspace ? 'Breakpoints Ready' : 'Debugger'}
                </span>
            </div>}
        </div>;
    }

    protected setRunMode(mode: InuRunMode): void {
        if (this.launching || this.sessionId) {
            return;
        }
        this.runMode = mode === 'debug' ? 'debug' : 'run';
        window.localStorage.setItem(RUN_MODE_STORAGE_KEY, this.runMode);
        window.dispatchEvent(new CustomEvent(RUN_MODE_CHANGED_EVENT, { detail: this.runMode }));
        this.update();
    }

    protected currentProjectPath(): string | undefined {
        const workspace = this.workspaceService.workspace;
        if (!workspace) {
            return undefined;
        }
        return workspace.resource.path.fsPath();
    }

    protected async toggleBreakpoint(): Promise<void> {
        const widget = this.editorManager.currentEditor;
        if (!widget) {
            await this.messageService.warn('Open the C# source file and place the caret on the line where you want a breakpoint.');
            return;
        }
        const editor = widget.editor;
        const sourcePath = editor.uri.path.fsPath();
        const line = editor.cursor.line + 1;
        const result = await this.breakpointManager.toggle(sourcePath, line);
        if (!result.success && this.sessionId) {
            // The source breakpoint remains visible/pending and will be retried on the
            // next Debug launch when fresh native symbols have been generated.
            await this.messageService.warn(result.message ?? 'The breakpoint is pending because Inu could not arm it in the current native image.');
        }
    }

    protected async sendDebugCommand(command: InuDebugCommand): Promise<void> {
        if (!this.sessionId) {
            return;
        }
        try {
            this.debugState = await this.projectService.debugCommand(this.sessionId, command);
            this.debugInspector.setState(this.debugState);
            this.syncPausedLineDecoration();
            this.update();
            await this.revealStoppedSource();
            if (this.debugState.paused) { await this.showDebugInspector(false); }
        } catch (error) {
            await this.messageService.error(error instanceof Error ? error.message : String(error));
        }
    }

    protected async revealStoppedSource(): Promise<void> {
        if (!this.debugState.paused || !this.debugState.sourcePath || !this.debugState.line) {
            return;
        }
        const key = `${this.debugState.sourcePath}:${this.debugState.line}`;
        if (key === this.lastRevealedStop) {
            return;
        }
        this.lastRevealedStop = key;
        try {
            const editor = await this.editorManager.open(FileUri.create(this.debugState.sourcePath));
            const position = { line: Math.max(0, this.debugState.line - 1), character: 0 };
            editor.editor.cursor = position;
            editor.editor.revealPosition(position);
            this.syncPausedLineDecoration();
        } catch {
            // The debugger remains usable even if an editor cannot be opened automatically.
        }
    }

    protected async showDebugInspector(activate = true): Promise<void> {
        if (!this.debugInspector.isAttached) {
            await this.shell.addWidget(this.debugInspector, { area: 'right', rank: 900 });
        }
        this.debugInspector.setState(this.debugState);
        if (activate) {
            this.shell.activateWidget(this.debugInspector.id);
        } else {
            this.shell.revealWidget(this.debugInspector.id);
        }
    }

    protected syncPausedLineDecoration(): void {
        const stoppedPath = this.debugState.paused && this.debugState.sourcePath
            ? this.normalizePath(this.debugState.sourcePath)
            : undefined;
        const stoppedLine = this.debugState.line;
        const liveEditors = new Set(MonacoEditor.getAll(this.editorManager));

        for (const [editor, decorations] of Array.from(this.pausedDecorations.entries())) {
            if (!liveEditors.has(editor)) {
                this.pausedDecorations.delete(editor);
                continue;
            }
            if (!stoppedPath || this.normalizePath(editor.uri.path.fsPath()) !== stoppedPath) {
                editor.getControl().deltaDecorations(decorations, []);
                this.pausedDecorations.delete(editor);
            }
        }

        if (!stoppedPath || !stoppedLine) { return; }
        for (const editor of liveEditors) {
            if (this.normalizePath(editor.uri.path.fsPath()) !== stoppedPath) { continue; }
            const old = this.pausedDecorations.get(editor) ?? [];
            const ids = editor.getControl().deltaDecorations(old, [{
                range: new monaco.Range(stoppedLine, 1, stoppedLine, 1),
                options: {
                    isWholeLine: true,
                    className: 'inu-current-statement-line',
                    glyphMarginClassName: 'inu-current-statement-glyph',
                    linesDecorationsClassName: 'inu-current-statement-lines'
                }
            }]);
            this.pausedDecorations.set(editor, ids);
        }
    }

    protected normalizePath(value: string): string {
        return value.replace(/\\/g, '/').toLowerCase();
    }

    protected armRunButtonDelay(): void {
        this.runButtonLocked = true;
        if (this.runButtonUnlockTimer !== undefined) {
            window.clearTimeout(this.runButtonUnlockTimer);
        }
        this.runButtonUnlockTimer = window.setTimeout(() => {
            this.runButtonUnlockTimer = undefined;
            this.runButtonLocked = false;
            this.update();
        }, 2000);
    }

    protected async requestStopForSession(sessionId: string): Promise<boolean> {
        const result = await this.projectService.stopOperatingSystem(sessionId);
        if (result.success) {
            return true;
        }
        const message = result.error ?? 'Kath could not cancel the current Inu run.';
        const channel = this.outputChannelManager.getChannel(OUTPUT_CHANNEL_NAME);
        channel.appendLine(`[FAIL] ${message}`);
        this.problemsWidget.addBuildFailure(message);
        await this.messageService.error(message);
        return false;
    }

    protected async stopCurrentOperatingSystem(): Promise<void> {
        if ((!this.launching && !this.sessionId) || this.stopRequested || this.runButtonLocked) {
            return;
        }

        this.stopRequested = true;
        this.cancelPendingSession = true;
        this.update();

        if (this.sessionId) {
            const stopped = await this.requestStopForSession(this.sessionId);
            if (!stopped) {
                this.stopRequested = false;
                this.cancelPendingSession = false;
                this.update();
            }
        }
    }

    protected async runCurrentOperatingSystem(): Promise<void> {
        const projectPath = this.currentProjectPath();
        if (!projectPath || this.launching || this.sessionId) {
            return;
        }

        this.armRunButtonDelay();
        this.launching = true;
        this.stopRequested = false;
        this.cancelPendingSession = false;
        this.debugState = { active: false, paused: false, sourceSymbols: false };
        this.update();
        const channel = this.outputChannelManager.getChannel(OUTPUT_CHANNEL_NAME);
        channel.clear();
        this.problemsWidget.clear();
        channel.show({ preserveFocus: false });
        // Run/Debug output belongs to Theia's bottom Output panel.
        // Keep the dedicated Kernel Console as an explicit Engineering tool only;
        // do not attach or activate it automatically, which would duplicate output.
        this.kernelConsole.clear();
        const consoleHeader = '';
        channel.append(consoleHeader);
        this.kernelConsole.append(consoleHeader);

        try {
            const modeLabel = this.runMode === 'debug' ? 'Debug' : 'No Debug';
            channel.appendLine(`[INFO] Inu ${modeLabel}: ${projectPath}`);
            channel.appendLine('[INFO] Build and launch output follows.');
            channel.appendLine('');
            channel.appendLine('[INFO] Saving all modified files before build.');
            await this.shell.saveAll();
            channel.appendLine('[ OK ] All modified files saved.');
            channel.appendLine('');

            const requestedBreakpoints = this.runMode === 'debug'
                ? this.breakpointManager.all().map(({ sourcePath, line, condition, hitCondition }) => ({ sourcePath, line, condition, hitCondition }))
                : undefined;
            const exceptionBreakpoints = this.runMode === 'debug' ? this.debugInspector.getExceptionBreakpoints() : undefined;
            const result = await this.projectService.runOperatingSystem(projectPath, this.runMode, requestedBreakpoints, exceptionBreakpoints);
            if (!result.success || !result.sessionId) {
                const message = result.error ?? 'Inu could not start the selected operating system.';
                channel.appendLine(`[FAIL] ${message}`);
                this.problemsWidget.addBuildFailure(message);
                await this.revealProblems();
                await this.messageService.error(message);
                return;
            }

            this.sessionId = result.sessionId;
            this.debugInspector.setSession(result.sessionId);
            this.launching = false;
            this.update();

            if (this.cancelPendingSession) {
                await this.requestStopForSession(result.sessionId);
            }

            let offset = 0;
            let failureAlreadyReported = false;
            while (this.sessionId === result.sessionId) {
                const output = await this.projectService.readRunOutput(result.sessionId, offset);
                if (output.text) {
                    if (output.text.includes('[FAIL]')) { failureAlreadyReported = true; }
                    channel.append(output.text);
                    this.kernelConsole.append(output.text);
                    this.problemsWidget.appendOutput(output.text);
                }
                if (output.kernelText) {
                    // Full-output mode: guest/kernel serial remains in the dedicated
                    // Kernel Console and is also mirrored into the normal Inu Build
                    // output so Run/Debug has one complete chronological transcript.
                    channel.append(output.kernelText);
                    this.kernelConsole.append(output.kernelText);
                }
                offset = output.nextOffset;

                if (this.runMode === 'debug') {
                    this.debugState = await this.projectService.debugState(result.sessionId);
                    this.debugInspector.setState(this.debugState);
                    this.syncPausedLineDecoration();
                    this.breakpointManager.applyRuntimeBreakpoints(this.debugState.breakpoints);
                    if (this.debugState.active && this.breakpointsArmedForSession !== result.sessionId) {
                        this.breakpointsArmedForSession = result.sessionId;
                        this.breakpointManager.setSession(result.sessionId);
                    }
                    this.update();
                    await this.revealStoppedSource();
                    if (this.debugState.paused) { await this.showDebugInspector(false); }
                }

                if (output.complete) {
                    this.problemsWidget.appendOutput('', true);
                    if (output.error && !failureAlreadyReported) {
                        channel.appendLine(`\n[FAIL] ${output.error}`);
                        this.kernelConsole.append(`\n[FAIL] ${output.error}\n`);
                        this.problemsWidget.addBuildFailure(output.error);
                        failureAlreadyReported = true;
                    }
                    if (output.exitCode === 0) {
                        const done = ''; 
                        channel.append(done); this.kernelConsole.append(done);
                    } else {
                        const exitCode = output.exitCode ?? -1;
                        if (!failureAlreadyReported) {
                            const failed = `\n[FAIL] Inu build/run command exited with code ${exitCode}.\n`;
                            channel.append(failed); this.kernelConsole.append(failed);
                            this.problemsWidget.appendOutput(failed, true);
                        }
                        await this.revealProblems();
                        await this.messageService.error(`Inu Run failed with exit code ${exitCode}.`);
                    }
                    break;
                }

                await new Promise(resolve => window.setTimeout(resolve, 100));
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            channel.appendLine(`\n[FAIL] ${message}`);
            this.kernelConsole.append(`\n[FAIL] ${message}\n`);
            this.problemsWidget.addBuildFailure(message);
            await this.revealProblems();
            await this.messageService.error(`Inu Run failed: ${message}`);
        } finally {
            this.launching = false;
            this.sessionId = undefined;
            this.stopRequested = false;
            this.cancelPendingSession = false;
            this.debugInspector.setSession(undefined);
            this.breakpointManager.setSession(undefined);
            this.debugState = { active: false, paused: false, sourceSymbols: false };
            this.debugInspector.setState(this.debugState);
            this.syncPausedLineDecoration();
            this.lastRevealedStop = '';
            this.breakpointsArmedForSession = undefined;
            this.update();
        }
    }
}
