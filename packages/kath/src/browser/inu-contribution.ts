import { CommandService } from '@theia/core/lib/common/command';

import { inject, injectable } from 'inversify';
import { BoxLayout } from '@lumino/widgets';
import { Command, CommandContribution, CommandRegistry, MAIN_MENU_BAR, MenuContribution, MenuModelRegistry, MessageService } from '@theia/core/lib/common';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { AbstractViewContribution, CommonMenus, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { NavigatorContextMenu } from '@theia/navigator/lib/browser/navigator-contribution';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { EDITOR_CONTEXT_MENU, EDITOR_LINENUMBER_CONTEXT_MENU, EditorManager } from '@theia/editor/lib/browser';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { InuBreakpointManager } from './inu-breakpoint-manager';
import { InuWidget, INU_EXPLICIT_WORKSPACE_OPEN } from './inu-widget';
import { InuToolbarWidget } from './inu-toolbar-widget';
import { InuDashboardWidget } from './inu-dashboard-widget';
import { InuKernelConsoleWidget } from './inu-kernel-console-widget';
import { InuHardwareWidget } from './inu-hardware-widget';
import { InuTraceWidget } from './inu-trace-widget';
import { InuProfilerWidget } from './inu-profiler-widget';
import { InuDriverCentreWidget } from './inu-driver-centre-widget';
import { InuTargetManagerWidget } from './inu-target-manager-widget';
import { InuStaticAnalyzerWidget } from './inu-static-analyzer-widget';
import { InuBinarySymbolExplorerWidget } from './inu-binary-symbol-explorer-widget';
import { InuMemoryMapVisualizerWidget } from './inu-memory-map-visualizer-widget';
import { InuInterruptApicVisualizerWidget } from './inu-interrupt-apic-visualizer-widget';
import { InuSyscallExplorerWidget } from './inu-syscall-explorer-widget';
import { InuSdkApiWidget } from './inu-sdk-api-widget';
import { InuImageDiskExplorerWidget } from './inu-image-disk-explorer-widget';
import { InuPhysicalDebuggerWidget } from './inu-physical-debugger-widget';
import { InuProblemsWidget } from './inu-problems-widget';
import { KathArchitectureWidget } from './kath-architecture-widget';
import { KathComponentLibraryWidget } from './kath-component-library-widget';
import { KathComponentInspectorWidget } from './kath-component-inspector-widget';
import { InuProjectService, InuSdkCommand } from '../common/inu-protocol';

export namespace InuCommands {
    export const OPEN: Command = {
        id: 'inu.openConfigurator',
        label: 'Inu: Create Operating System'
    };

    export const RECONFIGURE: Command = {
        id: 'inu.reconfigureOperatingSystem',
        label: 'Reconfigure Inu OS'
    };

    export const RECONFIGURE_ROOT_CONTEXT: Command = {
        id: 'inu.reconfigureOperatingSystem.rootContext',
        label: 'Reconfigure Inu OS'
    };

    export const TOGGLE_BREAKPOINT: Command = {
        id: 'inu.debug.toggleBreakpoint',
        label: 'Toggle Breakpoint'
    };

    export const BREAKPOINT_CONDITION: Command = {
        id: 'inu.debug.breakpointCondition',
        label: 'Edit Breakpoint Condition…'
    };

    export const BREAKPOINT_HIT_COUNT: Command = {
        id: 'inu.debug.breakpointHitCount',
        label: 'Edit Breakpoint Hit Count…'
    };
    export const ARCHITECTURE: Command = { id: 'kath.architecture', label: 'Open OS Architecture' };
    export const COMPONENTS: Command = { id: 'kath.components', label: 'Open Component Library' };
    export const COMPONENT_INSPECTOR: Command = { id: 'kath.componentInspector', label: 'Open Component Inspector' };
    export const DASHBOARD: Command = { id: 'inu.dashboard', label: 'Open OS Dashboard' };
    export const CONSOLE: Command = { id: 'inu.console', label: 'Open Kernel Console' };
    export const HARDWARE: Command = { id: 'inu.hardware', label: 'Open Hardware / Device Tree' };
    export const TRACE: Command = { id: 'inu.trace', label: 'Open Tracing / Boot Analyser' };
    export const PROFILER: Command = { id: 'inu.profiler', label: 'Open Performance Profiler' };
    export const DRIVERS: Command = { id: 'inu.engineering.drivers', label: 'Driver Development Centre' };
    export const TARGETS: Command = { id: 'inu.engineering.targets', label: 'Target Manager' };
    export const ANALYZERS: Command = { id: 'inu.engineering.analyzers', label: 'OS-specific Static Analyzers' };
    export const BINARIES: Command = { id: 'inu.engineering.binarySymbols', label: 'Binary / Symbol Explorer' };
    export const MEMORY_MAP: Command = { id: 'inu.engineering.memoryMap', label: 'Memory-map Visualiser' };
    export const INTERRUPTS: Command = { id: 'inu.engineering.interruptApic', label: 'Interrupt / APIC Visualiser' };
    export const SYSCALLS: Command = { id: 'inu.engineering.syscalls', label: 'Syscall Explorer' };
    export const IMAGES: Command = { id: 'inu.engineering.imageDiskExplorer', label: 'Image / Disk Explorer' };
    export const PHYSICAL_DEBUGGER: Command = { id: 'inu.engineering.physicalDebugger', label: 'Physical-machine Debugger Transport' };
    export const SDK_API: Command = { id: 'inu.help.sdkApi', label: 'SDK API' };
    export const GO_BUILD: Command = { id: 'inu.go.build', label: 'Build Inu OS' };
    export const GO_RUN: Command = { id: 'inu.go.run', label: 'Run Inu OS' };
    export const GO_DEBUG: Command = { id: 'inu.go.debug', label: 'Debug Inu OS' };
}

@injectable()
export class InuContribution extends AbstractViewContribution<InuWidget>
    implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;


    @inject(SelectionService)
    protected readonly selectionService!: SelectionService;

    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    @inject(InuBreakpointManager)
    protected readonly breakpointManager!: InuBreakpointManager;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @inject(OutputChannelManager)
    protected readonly outputChannelManager!: OutputChannelManager;

    @inject(InuProjectService)
    protected readonly projectService!: InuProjectService;

    @inject(InuToolbarWidget) protected readonly toolbarWidget!: InuToolbarWidget;
    @inject(InuDashboardWidget) protected readonly dashboardWidget!: InuDashboardWidget;
    @inject(InuKernelConsoleWidget) protected readonly consoleWidget!: InuKernelConsoleWidget;
    @inject(InuHardwareWidget) protected readonly hardwareWidget!: InuHardwareWidget;
    @inject(InuTraceWidget) protected readonly traceWidget!: InuTraceWidget;
    @inject(InuProfilerWidget) protected readonly profilerWidget!: InuProfilerWidget;
    @inject(InuDriverCentreWidget) protected readonly driverCentreWidget!: InuDriverCentreWidget;
    @inject(InuTargetManagerWidget) protected readonly targetManagerWidget!: InuTargetManagerWidget;
    @inject(InuStaticAnalyzerWidget) protected readonly staticAnalyzerWidget!: InuStaticAnalyzerWidget;
    @inject(InuBinarySymbolExplorerWidget) protected readonly binarySymbolExplorerWidget!: InuBinarySymbolExplorerWidget;
    @inject(InuMemoryMapVisualizerWidget) protected readonly memoryMapVisualizerWidget!: InuMemoryMapVisualizerWidget;
    @inject(InuInterruptApicVisualizerWidget) protected readonly interruptApicVisualizerWidget!: InuInterruptApicVisualizerWidget;
    @inject(InuSyscallExplorerWidget) protected readonly syscallExplorerWidget!: InuSyscallExplorerWidget;
    @inject(InuSdkApiWidget) protected readonly sdkApiWidget!: InuSdkApiWidget;
    @inject(InuImageDiskExplorerWidget) protected readonly imageDiskExplorerWidget!: InuImageDiskExplorerWidget;
    @inject(InuPhysicalDebuggerWidget) protected readonly physicalDebuggerWidget!: InuPhysicalDebuggerWidget;
    @inject(InuProblemsWidget) protected readonly problemsWidget!: InuProblemsWidget;
    @inject(KathArchitectureWidget) protected readonly architectureWidget!: KathArchitectureWidget;
    @inject(KathComponentLibraryWidget) protected readonly componentLibraryWidget!: KathComponentLibraryWidget;
    @inject(KathComponentInspectorWidget) protected readonly componentInspectorWidget!: KathComponentInspectorWidget;

    protected toolbarInstalled = false;
    protected titleLogoInstalled = false;
    protected bottomPanelControlsInstalled = false;
    protected bottomPanelObserver: MutationObserver | undefined;

    constructor() {
        super({
            widgetId: InuWidget.ID,
            widgetName: InuWidget.LABEL,
            defaultWidgetOptions: { area: 'main' },
            toggleCommandId: InuCommands.OPEN.id
        });
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(InuCommands.OPEN, {
            execute: () => this.openView({ activate: true, reveal: true })
        });

        commands.registerCommand(InuCommands.RECONFIGURE, {
            execute: () => this.reconfigureCurrentOperatingSystem(),
            isEnabled: () => !!this.currentOperatingSystemPath(),
            isVisible: () => !!this.currentOperatingSystemPath()
        });

        commands.registerCommand(InuCommands.RECONFIGURE_ROOT_CONTEXT, {
            execute: () => this.reconfigureCurrentOperatingSystem(),
            isEnabled: () => this.isOperatingSystemRootSelected(),
            isVisible: () => this.isOperatingSystemRootSelected()
        });

        commands.registerCommand(InuCommands.TOGGLE_BREAKPOINT, {
            execute: () => this.toggleCurrentBreakpoint(),
            // Keep the command present in the editor context menu even when Theia
            // temporarily has no currentEditor while the context menu owns focus.
            isEnabled: () => true,
            isVisible: () => true
        });

        commands.registerCommand(InuCommands.BREAKPOINT_CONDITION, {
            execute: () => this.editCurrentBreakpointCondition(),
            isEnabled: () => true,
            isVisible: () => true
        });

        commands.registerCommand(InuCommands.BREAKPOINT_HIT_COUNT, {
            execute: () => this.editCurrentBreakpointHitCount(),
            isEnabled: () => true,
            isVisible: () => true
        });
        commands.registerCommand(InuCommands.ARCHITECTURE, { execute: () => this.showKathArchitecture(), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.COMPONENTS, { execute: () => this.showKathSideWidget(this.componentLibraryWidget, 'left'), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.COMPONENT_INSPECTOR, { execute: () => this.showKathSideWidget(this.componentInspectorWidget, 'right'), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.DASHBOARD, { execute: () => this.showEngineeringWidget(this.dashboardWidget), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.CONSOLE, { execute: () => this.showEngineeringWidget(this.consoleWidget) });
        commands.registerCommand(InuCommands.HARDWARE, { execute: () => this.showEngineeringWidget(this.hardwareWidget), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.TRACE, { execute: () => this.showEngineeringWidget(this.traceWidget), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.PROFILER, { execute: () => this.showEngineeringWidget(this.profilerWidget), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.DRIVERS, { execute: () => this.showEngineeringWidget(this.driverCentreWidget), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.TARGETS, { execute: () => this.showEngineeringWidget(this.targetManagerWidget), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.ANALYZERS, {
            execute: () => {
                this.staticAnalyzerWidget.setProjectPath(this.currentOperatingSystemPath());
                return this.showEngineeringWidget(this.staticAnalyzerWidget);
            },
            isEnabled: () => !!this.currentOperatingSystemPath()
        });
        commands.registerCommand(InuCommands.BINARIES, {
            execute: () => {
                this.binarySymbolExplorerWidget.setProjectPath(this.currentOperatingSystemPath());
                return this.showEngineeringWidget(this.binarySymbolExplorerWidget);
            },
            isEnabled: () => !!this.currentOperatingSystemPath()
        });
        commands.registerCommand(InuCommands.MEMORY_MAP, {
            execute: () => {
                this.memoryMapVisualizerWidget.setProjectPath(this.currentOperatingSystemPath());
                return this.showEngineeringWidget(this.memoryMapVisualizerWidget);
            },
            isEnabled: () => !!this.currentOperatingSystemPath()
        });
        commands.registerCommand(InuCommands.INTERRUPTS, {
            execute: () => {
                this.interruptApicVisualizerWidget.setProjectPath(this.currentOperatingSystemPath());
                return this.showEngineeringWidget(this.interruptApicVisualizerWidget);
            },
            isEnabled: () => !!this.currentOperatingSystemPath()
        });
        commands.registerCommand(InuCommands.SYSCALLS, {
            execute: () => {
                this.syscallExplorerWidget.setProjectPath(this.currentOperatingSystemPath());
                return this.showEngineeringWidget(this.syscallExplorerWidget);
            },
            isEnabled: () => !!this.currentOperatingSystemPath()
        });
        commands.registerCommand(InuCommands.IMAGES, { execute: async () => { await this.showEngineeringWidget(this.imageDiskExplorerWidget); await this.imageDiskExplorerWidget.refresh(); }, isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.PHYSICAL_DEBUGGER, { execute: async () => { await this.showEngineeringWidget(this.physicalDebuggerWidget); await this.physicalDebuggerWidget.refresh(); }, isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.GO_BUILD, { execute: () => this.executeSdkCommand('build'), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.GO_RUN, { execute: () => this.toolbarWidget.run('run'), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.GO_DEBUG, { execute: () => this.toolbarWidget.run('debug'), isEnabled: () => !!this.currentOperatingSystemPath() });
        commands.registerCommand(InuCommands.SDK_API, { execute: () => this.showEngineeringWidget(this.sdkApiWidget) });
    }


    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(['1_file', '1_new'], {
            commandId: InuCommands.OPEN.id,
            label: 'Inu Operating System'
        });

        const goMenu = [...MAIN_MENU_BAR, '5_go'];
        menus.registerMenuAction([...goMenu, '8_inu_sdk'], { commandId: InuCommands.GO_BUILD.id, label: 'Build Inu OS', order: '0' });
        menus.registerMenuAction([...goMenu, '8_inu_sdk'], { commandId: InuCommands.GO_RUN.id, label: 'Run Inu OS', order: '1' });
        menus.registerMenuAction([...goMenu, '8_inu_sdk'], { commandId: InuCommands.GO_DEBUG.id, label: 'Debug Inu OS', order: '2' });

        const inuMenu = [...MAIN_MENU_BAR, '8_inu'];
        menus.registerSubmenu(inuMenu, 'Inu', { sortString: '8' });
        menus.registerSubmenu([...inuMenu, '2_engineering'], 'Engineering');
        menus.registerMenuAction([...inuMenu, '1_configuration'], {
            commandId: InuCommands.RECONFIGURE.id,
            label: 'Reconfigure OS'
        });
        menus.registerSubmenu([...inuMenu, '0_architecture'], 'Architecture');
        menus.registerMenuAction([...inuMenu, '0_architecture'], { commandId: InuCommands.ARCHITECTURE.id, label: 'OS Architecture', order: '0' });
        menus.registerMenuAction([...inuMenu, '0_architecture'], { commandId: InuCommands.COMPONENTS.id, label: 'Component Library', order: '1' });
        menus.registerMenuAction([...inuMenu, '0_architecture'], { commandId: InuCommands.COMPONENT_INSPECTOR.id, label: 'Component Inspector', order: '2' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.DASHBOARD.id, label: 'OS Dashboard', order: '0' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.CONSOLE.id, label: 'Kernel Console', order: '1' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.HARDWARE.id, label: 'Hardware / Device Tree', order: '2' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.TRACE.id, label: 'Tracing / Boot Analyser', order: '4' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.PROFILER.id, label: 'Performance Profiler', order: '5' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.DRIVERS.id, label: 'Driver Development Centre', order: '6' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.TARGETS.id, label: 'Target Manager', order: '7' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.ANALYZERS.id, label: 'OS-specific Static Analyzers', order: '8' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.BINARIES.id, label: 'Binary / Symbol Explorer', order: '9' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.MEMORY_MAP.id, label: 'Memory-map Visualiser', order: '10' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.INTERRUPTS.id, label: 'Interrupt / APIC Visualiser', order: '11' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.SYSCALLS.id, label: 'Syscall Explorer', order: '12' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.IMAGES.id, label: 'Image / Disk Explorer', order: '13' });
        menus.registerMenuAction([...inuMenu, '2_engineering'], { commandId: InuCommands.PHYSICAL_DEBUGGER.id, label: 'Physical-machine Debugger Transport', order: '14' });
        menus.registerMenuAction(CommonMenus.HELP, { commandId: InuCommands.SDK_API.id, label: 'SDK API', order: 'a20' });

        menus.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
            commandId: InuCommands.RECONFIGURE_ROOT_CONTEXT.id,
            label: 'Reconfigure Inu OS',
            order: '0'
        });

        const editorDebugMenu = [...EDITOR_CONTEXT_MENU, '2_inu_debug'];
        menus.registerSubmenu(editorDebugMenu, 'Debug');
        menus.registerMenuAction([...editorDebugMenu, '1_breakpoints'], {
            commandId: InuCommands.TOGGLE_BREAKPOINT.id,
            label: 'Toggle Breakpoint',
            order: '0'
        });
        menus.registerMenuAction([...editorDebugMenu, '1_breakpoints'], {
            commandId: InuCommands.BREAKPOINT_CONDITION.id,
            label: 'Edit Breakpoint Condition…',
            order: '1'
        });
        menus.registerMenuAction([...editorDebugMenu, '1_breakpoints'], {
            commandId: InuCommands.BREAKPOINT_HIT_COUNT.id,
            label: 'Edit Breakpoint Hit Count…',
            order: '2'
        });

        // Theia uses a distinct menu for right-clicks on the line-number/glyph
        // gutter. Link the same Debug submenu there so both source and gutter
        // context menus expose Debug -> Toggle Breakpoint.
        menus.linkCompoundMenuNode({
            newParentPath: EDITOR_LINENUMBER_CONTEXT_MENU,
            submenuPath: editorDebugMenu
        });
    }

    protected async executeSdkCommand(command: InuSdkCommand): Promise<void> {
        const projectPath = this.currentOperatingSystemPath();
        if (!projectPath) {
            await this.messageService.warn('Open a Inu operating system first.');
            return;
        }
        const channel = this.outputChannelManager.getChannel('Inu Build');
        channel.clear();
        this.problemsWidget.clear();
        channel.show({ preserveFocus: false });
        channel.appendLine(`[INFO] Go -> ${command}: ${projectPath}`);
        channel.appendLine('[INFO] Saving all modified files before invoking the Inu SDK.');
        await this.shell.saveAll();
        const started = await this.projectService.runSdkCommand(projectPath, command);
        if (!started.success || !started.runId) {
            const message = started.error ?? `Inu SDK ${command} could not start.`;
            channel.appendLine(`[FAIL] ${message}`);
            await this.messageService.error(message);
            return;
        }
        let offset = 0;
        for (;;) {
            const output = await this.projectService.readSdkCommandOutput(started.runId, offset);
            if (output.text) { channel.append(output.text); this.problemsWidget.appendOutput(output.text); }
            offset = output.nextOffset;
            if (output.complete) {
                this.problemsWidget.appendOutput('', true);
                if (output.exitCode === 0) channel.appendLine(`
[ OK ] Inu SDK ${command} completed successfully.`);
                else {
                    channel.appendLine(`
[FAIL] Inu SDK ${command} exited with code ${output.exitCode ?? -1}.`);
                    await this.messageService.error(`Inu SDK ${command} failed with exit code ${output.exitCode ?? -1}.`);
                }
                break;
            }
            await new Promise(resolve => window.setTimeout(resolve, 100));
        }
    }

    async onStart(): Promise<void> {
        this.installTitleLogo();
        this.installToolbarBelowMenu();
        this.installBottomPanelControls();
        await this.workspaceService.ready;
        this.toolbarWidget.refresh();
        this.staticAnalyzerWidget.setProjectPath(this.currentOperatingSystemPath());

        // Kath must always start at its own OS chooser. The only time an
        // already-open workspace is allowed through startup is the one-shot reload
        // initiated by an explicit Open Existing OS action in Inu itself.
        const explicitOpen = window.sessionStorage.getItem(INU_EXPLICIT_WORKSPACE_OPEN);
        if (explicitOpen) {
            window.sessionStorage.removeItem(INU_EXPLICIT_WORKSPACE_OPEN);
            if (this.workspaceService.opened) {
                await this.showKathWorkspace();
                return;
            }
        } else if (this.workspaceService.opened) {
            await this.workspaceService.close();
            return;
        }

        await this.openView({ activate: true, reveal: true });
    }



    protected installTitleLogo(): void {
        if (this.titleLogoInstalled || document.getElementById('inu-title-logo')) { return; }
        const logo = document.createElement('div');
        logo.id = 'inu-title-logo';
        logo.setAttribute('role', 'img');
        logo.setAttribute('aria-label', 'Kath');
        logo.title = 'Kath';
        document.body.appendChild(logo);
        document.body.classList.add('inu-has-title-logo');
        this.titleLogoInstalled = true;
    }

    protected async toggleCurrentBreakpoint(): Promise<void> {
        const context = this.breakpointManager.consumeContextLocation();
        if (context && context.sourcePath.toLowerCase().endsWith('.cs')) {
            await this.breakpointManager.toggle(context.sourcePath, context.line);
            return;
        }

        const widget = this.editorManager.currentEditor ?? this.editorManager.activeEditor;
        if (!widget) {
            await this.messageService.warn('Open a C# source file before toggling a breakpoint.');
            return;
        }
        const sourcePath = widget.editor.uri.path.fsPath();
        if (!sourcePath.toLowerCase().endsWith('.cs')) {
            await this.messageService.warn('Breakpoints can currently be placed in C# source files.');
            return;
        }
        const line = widget.editor.cursor.line + 1;
        if (line < 1) {
            await this.messageService.warn('Place the caret on the source line where you want the breakpoint.');
            return;
        }
        await this.breakpointManager.toggle(sourcePath, line);
    }


    protected currentSourceLocation(): { sourcePath: string; line: number } | undefined {
        const context = this.breakpointManager.consumeContextLocation();
        if (context && context.sourcePath.toLowerCase().endsWith('.cs')) { return context; }
        const widget = this.editorManager.currentEditor ?? this.editorManager.activeEditor;
        if (!widget) { return undefined; }
        const sourcePath = widget.editor.uri.path.fsPath();
        if (!sourcePath.toLowerCase().endsWith('.cs')) { return undefined; }
        return { sourcePath, line: widget.editor.cursor.line + 1 };
    }

    protected async editCurrentBreakpointCondition(): Promise<void> {
        const location = this.currentSourceLocation();
        if (!location) {
            await this.messageService.warn('Open a C# source file and select the breakpoint line first.');
            return;
        }
        const current = this.breakpointManager.getOptions(location.sourcePath, location.line).condition ?? '';
        const value = window.prompt(
            'Breakpoint condition. Use x64 registers and integer expressions, for example: rax == 0x10, (rflags & 1) != 0, or [rsp+8] == 0. Leave blank to remove the condition.',
            current
        );
        if (value === null) { return; }
        const result = await this.breakpointManager.setCondition(location.sourcePath, location.line, value);
        if (result && !result.success) { await this.messageService.warn(result.message ?? 'Could not update breakpoint condition.'); }
    }

    protected async editCurrentBreakpointHitCount(): Promise<void> {
        const location = this.currentSourceLocation();
        if (!location) {
            await this.messageService.warn('Open a C# source file and select the breakpoint line first.');
            return;
        }
        const current = this.breakpointManager.getOptions(location.sourcePath, location.line).hitCondition ?? '';
        const value = window.prompt(
            'Breakpoint hit count. Examples: 5 (break on 5th hit), >=10, >20, <=3, <3, or %100 (every 100th hit). Leave blank to remove the hit-count rule.',
            current
        );
        if (value === null) { return; }
        const trimmed = value.trim();
        if (trimmed && !/^(?:=|==|>=|<=|>|<|%)?\s*[1-9][0-9]*$/.test(trimmed)) {
            await this.messageService.warn('Invalid hit-count rule. Use N, =N, >=N, >N, <=N, <N, or %N.');
            return;
        }
        const result = await this.breakpointManager.setHitCondition(location.sourcePath, location.line, trimmed);
        if (result && !result.success) { await this.messageService.warn(result.message ?? 'Could not update breakpoint hit count.'); }
    }

    protected currentOperatingSystemPath(): string | undefined {
        const workspace = this.workspaceService.workspace;
        if (!workspace) {
            return undefined;
        }
        return workspace.resource.path.fsPath();
    }

    protected selectedNavigatorPath(): string | undefined {
        const rawSelection = this.selectionService.selection as unknown;
        const selection = Array.isArray(rawSelection) ? rawSelection[0] : rawSelection;
        return this.pathFromNavigatorSelection(selection, new Set<object>());
    }

    protected pathFromNavigatorSelection(selection: unknown, visited: Set<object>): string | undefined {
        if (!selection || typeof selection !== 'object' || visited.has(selection)) {
            return undefined;
        }
        visited.add(selection);

        const candidate = selection as Record<string, unknown>;
        const path = candidate['path'];
        if (path && typeof path === 'object') {
            const fsPath = (path as { fsPath?: () => string }).fsPath;
            if (typeof fsPath === 'function') {
                return fsPath.call(path);
            }
        }

        const fsPath = candidate['fsPath'];
        if (typeof fsPath === 'string') {
            return fsPath;
        }
        if (typeof fsPath === 'function') {
            return (fsPath as () => string).call(selection);
        }

        for (const key of ['uri', 'resource', 'fileStat', 'stat']) {
            const nestedPath = this.pathFromNavigatorSelection(candidate[key], visited);
            if (nestedPath) {
                return nestedPath;
            }
        }
        return undefined;
    }

    protected isOperatingSystemRootSelected(): boolean {
        const projectPath = this.currentOperatingSystemPath();
        const selectedPath = this.selectedNavigatorPath();
        if (!projectPath || !selectedPath) {
            return false;
        }
        return projectPath.toLowerCase() === selectedPath.toLowerCase();
    }

    protected async reconfigureCurrentOperatingSystem(): Promise<void> {
        const projectPath = this.currentOperatingSystemPath();
        if (!projectPath) {
            return;
        }

        // The context-menu form is intended for the OS root. Menu-bar invocation
        // has no navigator selection requirement and always targets the open OS.
        await this.shell.saveAll();
        const widget = await this.widgetManager.getOrCreateWidget<InuWidget>(InuWidget.ID);
        if (await widget.beginReconfigureOperatingSystem(projectPath)) {
            await this.openView({ activate: true, reveal: true });
        }
    }

    protected async showKathWorkspace(): Promise<void> {
        await Promise.all([
            this.showKathSideWidget(this.componentLibraryWidget, 'left', false),
            this.showKathSideWidget(this.componentInspectorWidget, 'right', false)
        ]);
        await this.showKathArchitecture();
    }

    protected async showKathArchitecture(): Promise<void> {
        if (!this.architectureWidget.isAttached) {
            await this.shell.addWidget(this.architectureWidget, { area: 'main' });
        }
        await this.architectureWidget.refresh();
        this.shell.activateWidget(this.architectureWidget.id);
    }

    protected async showKathSideWidget(widget: KathComponentLibraryWidget | KathComponentInspectorWidget, area: 'left' | 'right', activate = true): Promise<void> {
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area, rank: 220 });
        }
        await widget.refresh();
        if (activate) { this.shell.activateWidget(widget.id); }
    }

    protected async showEngineeringWidget(widget: any): Promise<void> {
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'main' });
        }
        if (typeof widget.refresh === 'function') await widget.refresh();
        this.shell.activateWidget(widget.id);
    }

    /**
     * Reinstates Theia/Lumino's normal bottom-panel tab/control strip at the shell
     * level. The previous CSS-only fix could not restore a TabBar after Lumino had
     * hidden or collapsed it.
     */
    protected installBottomPanelControls(): void {
        if (this.bottomPanelControlsInstalled) {
            this.ensureBottomPanelControlStrip();
            return;
        }

        const repair = (): void => {
            window.requestAnimationFrame(() => this.ensureBottomPanelControlStrip());
        };
        this.bottomPanelObserver = new MutationObserver(repair);
        this.bottomPanelObserver.observe(document.body, { childList: true, subtree: true });

        this.ensureBottomPanelControlStrip();
        window.requestAnimationFrame(() => this.ensureBottomPanelControlStrip());
        this.bottomPanelControlsInstalled = true;
    }

    protected ensureBottomPanelControlStrip(): void {
        // Eclipse Theia 1.74 exposes the real bottom DockPanel directly from
        // ApplicationShell. Do not depend on a guessed DOM id.
        const bottom = this.shell.bottomPanel?.node;
        if (!bottom) {
            return;
        }

        bottom.classList.add('inu-bottom-panel-host');

        let strip = bottom.querySelector<HTMLElement>(':scope > .inu-bottom-control-strip');
        if (!strip) {
            strip = document.createElement('div');
            strip.className = 'inu-bottom-control-strip';
            strip.setAttribute('role', 'toolbar');
            strip.setAttribute('aria-label', 'Bottom panel controls');

            const left = document.createElement('div');
            left.className = 'inu-bottom-control-tabs';

            const problems = document.createElement('button');
            problems.type = 'button';
            problems.textContent = 'Problems';
            problems.title = 'Show Problems';
            problems.addEventListener('click', () => void this.activateBottomPanelView('Problems'));

            const output = document.createElement('button');
            output.type = 'button';
            output.textContent = 'Output';
            output.title = 'Show Output';
            output.addEventListener('click', () => void this.activateBottomPanelView('Output'));

            left.append(problems, output);
            output.classList.add('inu-bottom-tab-selected');
            output.setAttribute('aria-selected', 'true');
            problems.setAttribute('aria-selected', 'false');

            const right = document.createElement('div');
            right.className = 'inu-bottom-control-actions';

            const channel = document.createElement('span');
            channel.className = 'inu-bottom-output-channel';
            channel.textContent = 'Inu Build';
            channel.title = 'Active Inu output channel';

            const clear = document.createElement('button');
            clear.type = 'button';
            clear.textContent = 'Clear';
            clear.title = 'Clear Inu Build output';
            clear.addEventListener('click', () => {
                const problemsSelected = problems.classList.contains('inu-bottom-tab-selected');
                if (problemsSelected) this.problemsWidget.clear();
                else this.outputChannelManager.getChannel('Inu Build').clear();
            });

            const maximize = document.createElement('button');
            maximize.type = 'button';
            maximize.textContent = '↕';
            maximize.title = 'Maximize / restore bottom panel';
            maximize.addEventListener('click', () => {
                this.shell.bottomPanel.toggleMaximized();
            });

            const close = document.createElement('button');
            close.type = 'button';
            close.textContent = '×';
            close.title = 'Close bottom panel';
            close.addEventListener('click', () => {
                // ApplicationShell.collapseBottomPanel() is protected. The public
                // Lumino DockPanel inherits Widget.hide(), which is the correct
                // external way to hide the bottom area.
                this.shell.bottomPanel.hide();
            });

            right.append(channel, clear, maximize, close);
            strip.append(left, right);

            // Lumino owns the DockPanel's managed child layout. The toolbar is
            // therefore an absolute overlay on the shell-owned panel node.
            bottom.appendChild(strip);
        }

        strip.hidden = false;
        strip.style.removeProperty('display');
        strip.style.removeProperty('visibility');
        strip.style.removeProperty('opacity');
    }

    protected async activateBottomPanelView(label: 'Problems' | 'Output'): Promise<void> {
        if (label === 'Problems') {
            if (!this.problemsWidget.isAttached) {
                await this.shell.addWidget(this.problemsWidget, { area: 'bottom', rank: 10 });
            }
            this.shell.bottomPanel.show();
            await this.shell.activateWidget(this.problemsWidget.id);
            this.markBottomPanelSelection(label);
            return;
        }

        // Output remains Theia's real Output view; Problems is Inu's structured
        // compiler-diagnostic grid so it can navigate directly to SDK source lines.
        const commandIds = ['output:toggle', 'output:show', 'workbench.action.output.toggleOutput'];

        for (const commandId of commandIds) {
            try {
                // Theia 1.74 CommandService exposes executeCommand(), but not
                // getCommand(). Unknown command IDs reject/throw, so simply try
                // the compatible command IDs in order and fall through on failure.
                await this.commandService.executeCommand(commandId);
                this.markBottomPanelSelection(label);
                return;
            } catch {
                // Try the next compatible Theia/VS Code command id.
            }
        }

        // Fallback: activate the actual ApplicationShell widget by title.
        const widgets = this.shell.getWidgets('bottom');
        const match = widgets.find(widget =>
            (widget.title?.label ?? '').trim().toLowerCase() === label.toLowerCase()
        );
        if (match) {
            await this.shell.activateWidget(match.id);
            this.markBottomPanelSelection(label);
        }
    }

    protected markBottomPanelSelection(label: 'Problems' | 'Output'): void {
        const bottom = this.shell.bottomPanel?.node;
        if (!bottom) {
            return;
        }

        bottom.querySelectorAll<HTMLButtonElement>('.inu-bottom-control-tabs button').forEach(button => {
            const selected = (button.textContent ?? '').trim().toLowerCase() === label.toLowerCase();
            button.classList.toggle('inu-bottom-tab-selected', selected);
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
    }

    protected clickBottomPanelCSharpontrol(labels: string[]): void {
        const bottom =
            document.querySelector<HTMLElement>('#theia-bottom-panel')
            ?? document.querySelector<HTMLElement>('.theia-bottom-panel');
        if (!bottom) {
            return;
        }

        const controls = Array.from(bottom.querySelectorAll<HTMLElement>('button,[role="button"]'))
            .filter(node => !node.closest('.inu-bottom-control-strip'));
        const match = controls.find(node => {
            const text = `${node.getAttribute('title') ?? ''} ${node.getAttribute('aria-label') ?? ''} ${node.textContent ?? ''}`.toLowerCase();
            return labels.some(label => text.includes(label.toLowerCase()));
        });
        match?.click();
    }

    /**
     * Inserts the Inu controls into the already-created Theia shell layout.
     * Do not replace/rebind ApplicationShell: the toolbar itself depends on the
     * shell for saveAll(), so rebinding the shell to a class that injects the
     * toolbar creates a circular Inversify dependency and can exhaust V8 memory.
     */
    protected installToolbarBelowMenu(): void {
        if (this.toolbarInstalled || this.toolbarWidget.parent) {
            this.toolbarInstalled = true;
            return;
        }

        const layout = this.shell.layout;
        if (!(layout instanceof BoxLayout)) {
            throw new Error('Inu could not install the Run toolbar: Theia root layout is not a BoxLayout.');
        }

        layout.insertWidget(1, this.toolbarWidget);
        this.toolbarInstalled = true;
    }
}
