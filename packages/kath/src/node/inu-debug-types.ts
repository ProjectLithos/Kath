import type { ChildProcess } from 'child_process';
import type { GdbRspClient } from './inu-debug-support';
import type {
    InuRunMode,
    InuTargetProfile,
    InuDebugState,
    InuBreakpointRequest,
    InuBreakpointResult,
    InuExceptionBreakpointSettings,
    InuTraceEvent,
    InuBootStage
} from '../common/inu-protocol';

export interface SourceBreakpoint {
    sourcePath: string;
    line: number;
    resolvedLine: number;
    address: string;
    condition?: string;
    hitCondition?: string;
    hitCount: number;
}

export interface ResolvedSourceAddress {
    linkedAddress: bigint;
    resolvedLine: number;
    exactLine: boolean;
}

export interface NativeSourceLine {
    sourcePath: string;
    line: number;
    linkedAddress: string;
}

export interface NativeDebugMap {
    image?: string;
    map?: string;
    mapSha256?: string;
    pdb?: string;
    anchor: { symbol: string; linkedAddress: string; resumeSymbol?: string; resumeLinkedAddress?: string; transport?: string };
    entries: NativeSourceLine[];
}

export interface NativeVariableLocation {
    name: string;
    kind: 'local' | 'argument';
    functionStart: bigint;
    functionEnd: bigint;
    rangeStart?: bigint;
    rangeEnd?: bigint;
    register?: string;
    baseRegister?: string;
    offset?: bigint;
    typeName?: string;
}


export interface NativeGlobalSymbol {
    name: string;
    linkedAddress: bigint;
}

export interface PeSectionInfo {
    virtualAddress: number;
    virtualSize: number;
    rawOffset: number;
    rawSize: number;
}

export interface PeUnwindEntry {
    beginRva: number;
    endRva: number;
    unwindRva: number;
}

export interface PeUnwindTable {
    imageBase: bigint;
    bytes: Buffer;
    sections: PeSectionInfo[];
    entries: PeUnwindEntry[];
}

export interface PeImageLayout {
    imageBase: bigint;
    sections: Map<number, bigint>;
}

export interface StepPlan {
    kind: 'step-into' | 'step-over' | 'step-out';
    sourcePath?: string;
    line?: number;
    machineSteps: number;
    temporaryAddress?: bigint;
}

export interface RunSession {
    sessionId: string;
    output: string;
    complete: boolean;
    exitCode?: number;
    error?: string;
    mode: InuRunMode;
    projectRoot: string;
    /** The active Run.bat/Build-Inu command tree. Kept so Stop Run can cancel even during build. */
    launchProcess?: ChildProcess;
    qemu?: ChildProcess;
    /** QEMU Machine Protocol socket used only to classify Debug-session lifecycle/termination events. */
    qmpSocket?: import('net').Socket;
    /** Last QMP event that can explain why QEMU stopped or exited. */
    qmpTerminationEvent?: { event: string; reason?: string; guest?: boolean; detail?: string };
    physicalSerial?: ChildProcess;
    target?: InuTargetProfile;
    gdb?: GdbRspClient;
    debug?: InuDebugState;
    breakpoints: Map<string, SourceBreakpoint>;
    requestedBreakpoints: InuBreakpointRequest[];
    breakpointResults: InuBreakpointResult[];
    nativeDebugMap?: NativeDebugMap;
    relocationDelta?: bigint;
    preparingAnchor?: boolean;
    anchorStopResolve?: () => void;
    internalPause?: boolean;
    lastBreakpoint?: SourceBreakpoint;
    stepPlan?: StepPlan;
    exceptionBreakpoints: InuExceptionBreakpointSettings;
    exceptionBreakpointAddresses: Map<bigint, number>;
    /** Runtime address of the native per-vector IST/stack-switch table used to decode exception frames. */
    interruptStackSwitchAddress?: bigint;
    panicBreakpointAddress?: bigint;
    panicDebuggerBreakAddress?: bigint;
    nativeVariables?: NativeVariableLocation[];
    nativeVariablesMessage?: string;
    selectedThreadId?: string;
    unwindTable?: PeUnwindTable;
    unwindTableLoaded?: boolean;
    nativeGlobals?: NativeGlobalSymbol[];
    nativeGlobalsLoaded?: boolean;
    serialLogPath?: string;
    serialLogOffset?: number;
    qemuPid?: number;
    diagnosticReportPath?: string;
    diagnosticReportConsumed?: boolean;
    serialDisplayPending?: string;
    stoppedByUser?: boolean;
    startedAtMs: number;
    telemetryBuffer: string;
    structuredTelemetrySeen?: boolean;
    traceEvents: InuTraceEvent[];
    bootStages: Map<string, InuBootStage>;
    currentBootStage?: string;
    lastBootMilestoneMs?: number;
    profileSamples: Map<string, { samples: number; totalDurationMs: number; category: string }>;
    profileCpuSamples: Map<number, { samples: number; busySamples: number }>;
    profileCounters: Map<string, { category: string; count: number; totalDurationMs: number }>;
}
