import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WebSocketConnectionProvider, WidgetFactory } from '@theia/core/lib/browser';
import {
    INU_PROJECT_SERVICE_PATH,
    InuProjectService
} from '../common/inu-protocol';
import { InuContribution } from './inu-contribution';
import { InuWidget } from './inu-widget';
import { InuToolbarWidget } from './inu-toolbar-widget';
import { InuEditorEnvironmentContribution } from './inu-editor-environment';
import { InuBreakpointManager } from './inu-breakpoint-manager';
import { InuDebugInspectorWidget } from './inu-debug-inspector-widget';
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
import { KathSelectionService } from './kath-selection-service';
import './style/inu.css';

export default new ContainerModule(bind => {
    bind(InuProjectService).toDynamicValue(ctx => {
        const provider = ctx.container.get(WebSocketConnectionProvider);
        return provider.createProxy<InuProjectService>(INU_PROJECT_SERVICE_PATH);
    }).inSingletonScope();

    bind(InuWidget).toSelf();
    bind(InuToolbarWidget).toSelf().inSingletonScope();
    bind(InuDebugInspectorWidget).toSelf().inSingletonScope();
    bind(InuDashboardWidget).toSelf().inSingletonScope();
    bind(InuKernelConsoleWidget).toSelf().inSingletonScope();
    bind(InuHardwareWidget).toSelf().inSingletonScope();
    bind(InuTraceWidget).toSelf().inSingletonScope();
    bind(InuProfilerWidget).toSelf().inSingletonScope();
    bind(InuDriverCentreWidget).toSelf().inSingletonScope();
    bind(InuTargetManagerWidget).toSelf().inSingletonScope();
    bind(InuStaticAnalyzerWidget).toSelf().inSingletonScope();
    bind(InuBinarySymbolExplorerWidget).toSelf().inSingletonScope();
    bind(InuMemoryMapVisualizerWidget).toSelf().inSingletonScope();
    bind(InuInterruptApicVisualizerWidget).toSelf().inSingletonScope();
    bind(InuSyscallExplorerWidget).toSelf().inSingletonScope();
    bind(InuSdkApiWidget).toSelf().inSingletonScope();
    bind(InuImageDiskExplorerWidget).toSelf().inSingletonScope();
    bind(InuPhysicalDebuggerWidget).toSelf().inSingletonScope();
    bind(InuProblemsWidget).toSelf().inSingletonScope();
    bind(KathSelectionService).toSelf().inSingletonScope();
    bind(KathArchitectureWidget).toSelf().inSingletonScope();
    bind(KathComponentLibraryWidget).toSelf().inSingletonScope();
    bind(KathComponentInspectorWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: InuWidget.ID,
        createWidget: () => ctx.container.get(InuWidget)
    })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: InuDebugInspectorWidget.ID,
        createWidget: () => ctx.container.get(InuDebugInspectorWidget)
    })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuDashboardWidget.ID, createWidget: () => ctx.container.get(InuDashboardWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuKernelConsoleWidget.ID, createWidget: () => ctx.container.get(InuKernelConsoleWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuHardwareWidget.ID, createWidget: () => ctx.container.get(InuHardwareWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuTraceWidget.ID, createWidget: () => ctx.container.get(InuTraceWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuProfilerWidget.ID, createWidget: () => ctx.container.get(InuProfilerWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuDriverCentreWidget.ID, createWidget: () => ctx.container.get(InuDriverCentreWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuTargetManagerWidget.ID, createWidget: () => ctx.container.get(InuTargetManagerWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuStaticAnalyzerWidget.ID, createWidget: () => ctx.container.get(InuStaticAnalyzerWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuBinarySymbolExplorerWidget.ID, createWidget: () => ctx.container.get(InuBinarySymbolExplorerWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuMemoryMapVisualizerWidget.ID, createWidget: () => ctx.container.get(InuMemoryMapVisualizerWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuInterruptApicVisualizerWidget.ID, createWidget: () => ctx.container.get(InuInterruptApicVisualizerWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuSyscallExplorerWidget.ID, createWidget: () => ctx.container.get(InuSyscallExplorerWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuSdkApiWidget.ID, createWidget: () => ctx.container.get(InuSdkApiWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuImageDiskExplorerWidget.ID, createWidget: () => ctx.container.get(InuImageDiskExplorerWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuPhysicalDebuggerWidget.ID, createWidget: () => ctx.container.get(InuPhysicalDebuggerWidget) })).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: InuProblemsWidget.ID, createWidget: () => ctx.container.get(InuProblemsWidget) })).inSingletonScope();

    bind(InuBreakpointManager).toSelf().inSingletonScope();

    bind(InuEditorEnvironmentContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(InuEditorEnvironmentContribution);

    bind(InuContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(InuContribution);
    bind(MenuContribution).toService(InuContribution);
    bind(FrontendApplicationContribution).toService(InuContribution);
});
