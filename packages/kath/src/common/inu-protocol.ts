export const INU_PROJECT_SERVICE_PATH = '/services/inu-projects';
export const InuProjectService = Symbol('InuProjectService');

export type KernelArchitecture = 'monolithic' | 'microkernel' | 'hybrid' | 'custom';
export type TargetArchitecture = 'x86_64' | 'arm64' | 'riscv64';
export type BootArchitecture = 'uefi' | 'multiboot2' | 'direct';
export type KathStartupModel = 'none' | 'cli' | 'gui' | 'cli-gui' | 'custom';
export type KathExecutableFormat = 'elf64' | 'pe64' | 'flat' | 'custom';
export type KathExecutionArea = 'kernel' | 'userland';
export type MemorySystem = 'paged' | 'identity-mapped' | 'minimal';
export type SchedulerModel = 'none' | 'cooperative' | 'preemptive' | 'realtime';
export type ProcessSupport = 'none' | 'kernel-threads' | 'processes';
export type SyscallModel = 'inu' | 'linux' | 'windows-nt' | 'multi';
export type InterruptModel = 'architecture-default' | 'apic' | 'x2apic' | 'pic-compat';
export type FilesystemModel = 'none' | 'fatfs' | 'fat32';
export type NetworkStack = 'none' | 'ipv4' | 'dual-stack';
export type ShellModel = 'none' | 'inu-shell';
export type GuiModel = 'none' | 'framebuffer' | 'desktop';
export type AudioModel = 'none' | 'hda' | 'ac97';
export type VirtualisationModel = 'none' | 'guest' | 'hypervisor';
export type SafetyProfile = 'general' | 'rtos' | 'safety-critical';
export type InuQemuAccelerator = 'auto' | 'whpx' | 'kvm' | 'hvf' | 'tcg';

/** Legacy execution-role settings retained only so existing 0.2.x projects can still be opened. */
export interface InuCpuRoleAssignments {
    kernel: string;
    userland: string;
    gui: string;
    drivers: string;
    interrupts: string;
    networking: string;
    storage: string;
    realtime: string;
    background: string;
}

/**
 * Kath&Inu project definition.
 *
 * schemaVersion 9 makes the architectural intent explicit: x64 + UEFI today,
 * a coder-selected kernel model, executable formats, startup model and hardware
 * support. The legacy fields below remain during the 0.0.x transition because
 * the current native build/runtime consumes them; Kath derives them from the
 * new choices rather than asking the coder to configure them directly.
 */
export interface InuProjectConfiguration {
    schemaVersion: 9;
    name: string;
    author: string;
    location: string;
    logoPath: string;
    kernelArchitecture: KernelArchitecture;
    targetArchitecture: TargetArchitecture;
    bootArchitecture: BootArchitecture;
    executableFormats: KathExecutableFormat[];
    startupModel: KathStartupModel;
    hardwareSupport: string[];
    /**
     * Custom-kernel placement for selected post-boot mechanisms. Communication/process/syscall
     * substrate remains kernel-resident so selected execution areas can communicate.
     */
    customExecutionPlacements: Record<string, KathExecutionArea>;

    // Transitional implementation settings, derived by Kath rather than exposed
    // as primary OS-design choices in the rewritten configurator.
    qemuCpuCount: number;
    qemuAccelerator: InuQemuAccelerator;
    memorySystem: MemorySystem;
    scheduler: SchedulerModel;
    processSupport: ProcessSupport;
    syscallModel: SyscallModel;
    smp: boolean;
    cpuRoles: InuCpuRoleAssignments;
    interruptModel: InterruptModel;
    timers: string[];
    drivers: string[];
    storageControllers: string[];
    filesystem: FilesystemModel;
    networkStack: NetworkStack;
    networkDrivers: string[];
    input: string[];
    graphics: string[];
    audio: AudioModel;
    userland: boolean;
    shell: ShellModel;
    gui: GuiModel;
    guiDesktopPath: string;
    guiLoginPath: string;
    debugging: string[];
    testing: string[];
    virtualisation: VirtualisationModel;
    safetyProfile: SafetyProfile;
    safetyOptions: string[];
}

export interface InuOperatingSystem {
    id: string;
    name: string;
    location: string;
    path: string;
    uri: string;
    instanceNumber: number;
}

export type InuRunMode = 'run' | 'debug';
export type InuSdkCommand = 'build' | 'test' | 'doctor';

export interface InuSdkCommandRunResult {
    success: boolean;
    runId?: string;
    error?: string;
}

export interface InuSdkCommandOutput {
    text: string;
    nextOffset: number;
    complete: boolean;
    exitCode?: number;
    error?: string;
}

export type InuDebugCommand = 'continue' | 'pause' | 'step-into' | 'step-over' | 'step-out' | 'restart' | 'stop';

export interface InuDebugRegister {
    name: string;
    value: string;
}

export interface InuDebugFrame {
    index: number;
    address: string;
    label: string;
    sourcePath?: string;
    line?: number;
    kind?: 'managed' | 'native';
    unwoundBy?: 'x64-unwind' | 'leaf';
}

export interface InuDebugExecutionContext {
    id: string;
    threadId: string;
    processId?: string;
    cpuIndex?: number;
    name: string;
    current: boolean;
}


export interface InuDebugVariable {
    name: string;
    value: string;
    kind: 'local' | 'argument' | 'stack';
    location?: string;
    typeName?: string;
}

export interface InuMemoryReadResult {
    success: boolean;
    expression: string;
    address?: string;
    length?: number;
    bytes?: string;
    error?: string;
}


export interface InuPageTableEntry {
    level: 'PML4' | 'PDPT' | 'PD' | 'PT';
    index: number;
    entryPhysicalAddress: string;
    entryValue: string;
    present: boolean;
    writable: boolean;
    user: boolean;
    writeThrough: boolean;
    cacheDisable: boolean;
    accessed: boolean;
    dirty: boolean;
    largePage: boolean;
    global: boolean;
    noExecute: boolean;
    targetPhysicalAddress?: string;
}

export interface InuPageTableInspection {
    success: boolean;
    expression: string;
    virtualAddress?: string;
    cr3?: string;
    pageSize?: string;
    physicalAddress?: string;
    entries?: InuPageTableEntry[];
    error?: string;
}

export interface InuHeapBlock {
    index: number;
    state: 'free' | 'allocated';
    address: string;
    byteCount: number;
    token?: string;
}

export interface InuHeapSnapshot {
    success: boolean;
    initialized?: boolean;
    committedBytes?: number;
    allocatedBytes?: number;
    freeBytes?: number;
    peakAllocatedBytes?: number;
    liveAllocations?: number;
    freeBlocks?: number;
    blocks?: InuHeapBlock[];
    message?: string;
    error?: string;
}

export interface InuCrashDumpSummary {
    path: string;
    createdUtc: string;
    reason: string;
    formatVersion?: string;
    legacy?: boolean;
    sourcePath?: string;
    line?: number;
}

export interface InuCrashDumpSection<T> {
    version: number;
    available: boolean;
    data?: T;
    note?: string;
}

export interface InuCrashDumpCpuState {
    architecture: string;
    cpuIndex?: number;
    threadId?: string;
    processId?: string;
    instructionPointer?: string;
    stackPointer?: string;
    framePointer?: string;
    flags?: string;
    pageTableRoot?: string;
    executionContexts: InuDebugExecutionContext[];
}

export interface InuCrashDumpProcess {
    processId: string;
    name: string;
    current: boolean;
    threadIds: string[];
    cpuIndexes: number[];
}

export interface InuCrashDumpModule {
    name: string;
    imagePath?: string;
    pdbPath?: string;
    runtimeBase?: string;
    relocationDelta?: string;
    sourceEntryCount?: number;
}

export interface InuCrashDumpDriverState {
    id: string;
    configured: boolean;
    state: 'configured' | 'started' | 'stopped' | 'failed' | 'unknown';
    detail?: string;
}

export interface InuCrashDumpPanic {
    reason: string;
    exceptionVector?: number;
    exceptionName?: string;
    /** Actual interrupted instruction for a CPU-exception stop; distinct from the debugger stub RIP. */
    faultInstructionPointer?: string;
    sourcePath?: string;
    line?: number;
    message?: string;
}

export interface InuCrashDumpSections {
    cpuState: InuCrashDumpSection<InuCrashDumpCpuState>;
    registers: InuCrashDumpSection<InuDebugRegister[]>;
    stack: InuCrashDumpSection<{ frames: InuDebugFrame[]; memory?: InuMemoryReadResult }>;
    pageTables: InuCrashDumpSection<InuPageTableInspection>;
    processes: InuCrashDumpSection<InuCrashDumpProcess[]>;
    modules: InuCrashDumpSection<InuCrashDumpModule[]>;
    heap: InuCrashDumpSection<InuHeapSnapshot>;
    memoryRanges: InuCrashDumpSection<{ stack?: InuMemoryReadResult; code?: InuMemoryReadResult }>;
    panic: InuCrashDumpSection<InuCrashDumpPanic>;
    drivers: InuCrashDumpSection<InuCrashDumpDriverState[]>;
    telemetry: InuCrashDumpSection<{ serialTail?: string; records?: unknown[] }>;
}

export interface InuCrashDumpDocument {
    magic: 'NOCD';
    format: 'Inu Crash Dump';
    formatVersion: { major: number; minor: number };
    architecture: string;
    createdUtc: string;
    producer: { product: string; version: string };
    project?: { name?: string; root?: string };
    sections: InuCrashDumpSections;
}

export interface InuCrashDumpResult {
    success: boolean;
    dump?: InuCrashDumpSummary;
    document?: InuCrashDumpDocument;
    state?: InuDebugState;
    pageTable?: InuPageTableInspection;
    heap?: InuHeapSnapshot;
    memory?: { stack?: InuMemoryReadResult; code?: InuMemoryReadResult };
    error?: string;
}

export interface InuDisassemblyInstruction {
    runtimeAddress: string;
    linkedAddress: string;
    instruction: string;
    sourcePath?: string;
    line?: number;
    current?: boolean;
}

export interface InuExceptionBreakpointSettings {
    vectors: number[];
    breakOnPanic: boolean;
    /** Vector 2 is asynchronous and is armed only after an explicit user opt-in from Kath 0.0.189 onward. */
    nmiOptIn?: boolean;
}

export interface InuBreakpointRequest {
    sourcePath: string;
    line: number;
    condition?: string;
    hitCondition?: string;
}

export interface InuExpressionResult {
    success: boolean;
    expression: string;
    value?: string;
    hexValue?: string;
    error?: string;
}

export interface InuRunResult {
    success: boolean;
    sessionId?: string;
    error?: string;
}

export interface InuDebugState {
    active: boolean;
    paused: boolean;
    sourceSymbols: boolean;
    breakpoints?: InuBreakpointResult[];
    gdbPort?: number;
    sourcePath?: string;
    line?: number;
    message?: string;
    registers?: InuDebugRegister[];
    callStack?: InuDebugFrame[];
    locals?: InuDebugVariable[];
    localsMessage?: string;
    disassembly?: InuDisassemblyInstruction[];
    exceptionVector?: number;
    exceptionName?: string;
    /** Actual interrupted instruction for a CPU-exception stop; distinct from the vector-stub debugger RIP. */
    faultInstructionPointer?: string;
    executionContexts?: InuDebugExecutionContext[];
    selectedThreadId?: string;
}



export interface InuBreakpointResult {
    success: boolean;
    verified: boolean;
    sourcePath: string;
    line: number;
    resolvedLine?: number;
    address?: string;
    condition?: string;
    hitCondition?: string;
    hitCount?: number;
    message?: string;
}


export type InuTraceCategory = 'boot' | 'interrupt' | 'syscall' | 'scheduler' | 'driver' | 'memory' | 'storage' | 'network' | 'graphics' | 'diagnostic' | 'custom';
export type InuTracePhase = 'instant' | 'begin' | 'end';

export interface InuTraceEvent {
    id: number;
    timestampMs: number;
    category: InuTraceCategory;
    name: string;
    phase: InuTracePhase;
    cpuIndex?: number;
    durationMs?: number;
    details?: string;
    severity?: 'info' | 'warning' | 'error';
}

export interface InuBootStage {
    name: string;
    startMs: number;
    endMs?: number;
    durationMs?: number;
    status: 'running' | 'complete' | 'warning' | 'failed';
    details?: string;
}

export interface InuTraceSnapshot {
    active: boolean;
    sessionId?: string;
    capturedAtUtc: string;
    elapsedMs: number;
    events: InuTraceEvent[];
    bootStages: InuBootStage[];
    message?: string;
}

export interface InuTraceSaveResult {
    success: boolean;
    path?: string;
    error?: string;
}

export interface InuProfilerFunction {
    name: string;
    category: string;
    samples: number;
    totalDurationMs: number;
    averageDurationMs: number;
    percent: number;
}

export interface InuProfilerCpu {
    cpuIndex: number;
    samples: number;
    busySamples: number;
    utilisationPercent: number;
}

export interface InuProfilerCounter {
    name: string;
    category: string;
    count: number;
    totalDurationMs?: number;
    averageDurationMs?: number;
}

export interface InuProfilerSnapshot {
    active: boolean;
    sessionId?: string;
    capturedAtUtc: string;
    elapsedMs: number;
    totalSamples: number;
    functions: InuProfilerFunction[];
    cpus: InuProfilerCpu[];
    counters: InuProfilerCounter[];
    bootDurationMs?: number;
    message?: string;
}

export interface InuRunOutput {
    text: string;
    /** Fresh kernel/guest serial text for the dedicated Kernel Console only. */
    kernelText?: string;
    nextOffset: number;
    complete: boolean;
    exitCode?: number;
    error?: string;
}


export interface InuConfigurationResult {
    success: boolean;
    projectPath?: string;
    configuration?: InuProjectConfiguration;
    error?: string;
}


export type InuDriverTemplateKind = 'pci' | 'usb' | 'virtio' | 'platform';
export type InuDriverCapability = 'mmio' | 'pio' | 'interrupts' | 'msi' | 'msix' | 'dma' | 'pci-config' | 'physical-memory' | 'timers' | 'networking' | 'filesystem';

export interface InuDriverManifest {
    schemaVersion: 1 | 2 | 3;
    id: string;
    name: string;
    kind: InuDriverTemplateKind;
    version: string;
    sdkApiVersion: string;
    driverAbiVersion: string;
    architecture?: 'any' | 'x64' | 'arm64';
    minimumInuVersion?: string;
    ids?: string[];
    dependencies?: string[];
    permissions?: InuDriverCapability[];
    signing?: { state: 'unsigned' | 'development' | 'signed' | 'trusted' | 'revoked'; algorithm?: string; signerId?: string; digest?: string; };
    vendorId?: string;
    deviceId?: string;
    subsystemVendorId?: string;
    subsystemDeviceId?: string;
    classCode?: string;
    usbVendorId?: string;
    usbProductId?: string;
    virtioDeviceId?: number;
    capabilities: InuDriverCapability[];
    description?: string;
}

export type InuDeviceBus = 'platform' | 'pci' | 'usb' | 'acpi' | 'virtual' | 'logical';
export type InuDeviceLifecycleState = 'discovered' | 'probing' | 'probed' | 'binding' | 'bound' | 'starting' | 'started' | 'stopping' | 'stopped' | 'resetting' | 'suspending' | 'suspended' | 'resuming' | 'failed' | 'recovering' | 'removing' | 'removed';
export interface InuDeviceTreeNode { id: string; parentId?: string; bus: InuDeviceBus; name: string; state: InuDeviceLifecycleState; driverId?: string; vendorId?: string; deviceId?: string; classCode?: string; location?: string; children: InuDeviceTreeNode[]; }
export interface InuDeviceTreeCounts { total: number; pci: number; usb: number; acpi: number; platform: number; virtual: number; logical: number; }
export interface InuDeviceTreeSnapshot { schemaVersion: 1; generation: number; source: 'configuration' | 'runtime'; roots: InuDeviceTreeNode[]; counts: InuDeviceTreeCounts; message?: string; }

export interface InuDriverDescriptor {
    id: string;
    name: string;
    projectPath: string;
    manifestPath?: string;
    source: 'os' | 'configured';
    kind: InuDriverTemplateKind | 'configured';
    configured: boolean;
    manifest?: InuDriverManifest;
}

export interface InuCreateDriverRequest {
    name: string;
    kind: InuDriverTemplateKind;
    description?: string;
    vendorId?: string;
    deviceId?: string;
    usbVendorId?: string;
    usbProductId?: string;
    virtioDeviceId?: number;
    capabilities: InuDriverCapability[];
    createTestProject: boolean;
}

export interface InuCreateDriverResult {
    success: boolean;
    projectPath?: string;
    manifestPath?: string;
    testProjectPath?: string;
    error?: string;
}

export interface InuTestDescriptor {
    id: string;
    name: string;
    projectPath: string;
    source: 'os' | 'sdk';
    category: string;
}

export interface InuTestRunResult {
    success: boolean;
    runId?: string;
    error?: string;
}

export interface InuTestOutput {
    text: string;
    nextOffset: number;
    complete: boolean;
    exitCode?: number;
    error?: string;
}


export type InuHardwareMatrixPreset = 'balanced' | 'full';
export type InuHardwareMatrixStorage = 'virtio-blk' | 'ahci' | 'nvme';
export type InuHardwareMatrixNetwork = 'none' | 'virtio-net' | 'e1000';
export type InuHardwareMatrixGraphics = 'gop' | 'virtio-gpu';
export type InuHardwareMatrixUsb = 'none' | 'xhci';
export type InuHardwareMatrixFirmware = 'uefi' | 'bios';
export type InuHardwareMatrixCaseStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
export type InuHardwareValidationCoverageStatus = 'emulated' | 'implicit' | 'not-emulated';

export interface InuHardwareValidationCoverage {
    driverId: string;
    device: string;
    category: 'platform' | 'storage' | 'network' | 'graphics' | 'usb' | 'input';
    status: InuHardwareValidationCoverageStatus;
    caseIds: string[];
    message: string;
}

export interface InuHardwareMatrixCase {
    id: string;
    label: string;
    cpuCount: number;
    memoryMiB: number;
    storage: InuHardwareMatrixStorage;
    network: InuHardwareMatrixNetwork;
    graphics: InuHardwareMatrixGraphics;
    usb: InuHardwareMatrixUsb;
    firmware: InuHardwareMatrixFirmware;
    drivers: string[];
    status: InuHardwareMatrixCaseStatus;
    durationMs?: number;
    serialLogPath?: string;
    message?: string;
}

export interface InuHardwareMatrixPlan {
    success: boolean;
    preset: InuHardwareMatrixPreset;
    cases: InuHardwareMatrixCase[];
    coverage: InuHardwareValidationCoverage[];
    biosSupported: boolean;
    debugOnly: true;
    message?: string;
    error?: string;
}

export interface InuHardwareMatrixRunResult { success: boolean; runId?: string; error?: string; }
export interface InuHardwareMatrixOutput {
    text: string;
    nextOffset: number;
    complete: boolean;
    exitCode?: number;
    cases: InuHardwareMatrixCase[];
    passed: number;
    failed: number;
    skipped: number;
    error?: string;
}

export interface InuProjectResult {
    success: boolean;
    projectPath?: string;
    generatedProjects?: string[];
    error?: string;
}

export type InuTargetKind = 'qemu' | 'physical' | 'remote';
export type InuTargetArchitecture = 'x86_64' | 'arm64' | 'riscv64';
export type InuQemuDisplay = 'sdl' | 'gtk' | 'none';

export interface InuQemuTargetSettings {
    cpuCount: number;
    memoryMiB: number;
    machine: string;
    accelerator: InuQemuAccelerator;
    display: InuQemuDisplay;
}
export interface InuPhysicalTargetSettings { gdbHost: string; gdbPort: number; serialPort?: string; baudRate?: number; }
export interface InuPhysicalDebuggerProbe { success: boolean; targetId?: string; targetName?: string; host?: string; port?: number; connected: boolean; stopReply?: string; serialPort?: string; baudRate?: number; message?: string; error?: string; }
export interface InuRemoteTargetSettings { host: string; port: number; }
export interface InuTargetProfile {
    schemaVersion: 1;
    id: string;
    name: string;
    kind: InuTargetKind;
    architecture: InuTargetArchitecture;
    qemu?: InuQemuTargetSettings;
    physical?: InuPhysicalTargetSettings;
    remote?: InuRemoteTargetSettings;
}
export interface InuTargetState { schemaVersion: 1; activeTargetId: string; targets: InuTargetProfile[]; }
export interface InuTargetMutationResult { success: boolean; state?: InuTargetState; error?: string; }


export type InuAnalyzerSeverity = 'error' | 'warning' | 'info';
export type InuAnalyzerCategory = 'boundary' | 'architecture' | 'kernel-safety' | 'driver-capability' | 'interrupt-safety' | 'userland-safety';

export interface InuAnalyzerDiagnostic {
    code: string;
    severity: InuAnalyzerSeverity;
    category: InuAnalyzerCategory;
    message: string;
    filePath: string;
    line: number;
    column: number;
    rule: string;
}

export interface InuAnalyzerSnapshot {
    schemaVersion: 1;
    analyzedAtUtc: string;
    projectPath: string;
    filesAnalyzed: number;
    diagnostics: InuAnalyzerDiagnostic[];
    errorCount: number;
    warningCount: number;
    infoCount: number;
    targetArchitecture?: InuTargetArchitecture;
}


export type InuBinaryKind = 'pe' | 'coff' | 'pdb' | 'map' | 'debug-map' | 'archive' | 'unknown';
export type InuBinaryOrigin = 'os' | 'sdk';
export type InuBinarySymbolKind = 'function' | 'data' | 'public' | 'source-line' | 'unknown';

export interface InuBinaryDescriptor {
    id: string;
    name: string;
    path: string;
    origin: InuBinaryOrigin;
    kind: InuBinaryKind;
    sizeBytes: number;
    modifiedUtc: string;
}

export interface InuBinarySection {
    name: string;
    virtualAddress: string;
    virtualSize: number;
    rawSize: number;
    characteristics: string;
}

export interface InuBinarySymbol {
    name: string;
    address?: string;
    size?: number;
    kind: InuBinarySymbolKind;
    sourcePath?: string;
    line?: number;
}

export interface InuBinaryInspection {
    success: boolean;
    binary?: InuBinaryDescriptor;
    format?: string;
    architecture?: string;
    imageBase?: string;
    entryPoint?: string;
    sections: InuBinarySection[];
    symbols: InuBinarySymbol[];
    symbolCount: number;
    truncated: boolean;
    message?: string;
    error?: string;
}



export type InuMemoryRegionCategory = 'usable' | 'boot-reclaimable' | 'runtime' | 'acpi-reclaimable' | 'acpi-nvs' | 'mmio' | 'reserved' | 'unusable' | 'persistent' | 'unaccepted' | 'unknown';

export interface InuMemoryMapRegion {
    index: number;
    firmwareType: number;
    typeName: string;
    category: InuMemoryRegionCategory;
    physicalStart: string;
    physicalEnd: string;
    virtualStart: string;
    pageCount: number;
    byteCount: number;
    attributes: string;
}

export interface InuMemoryReservation {
    name: string;
    physicalStart: string;
    byteCount: number;
    details?: string;
}

export interface InuMemoryMapCategorySummary {
    category: InuMemoryRegionCategory;
    regionCount: number;
    byteCount: number;
}

export interface InuMemoryMapSnapshot {
    success: boolean;
    active: boolean;
    paused: boolean;
    capturedAtUtc: string;
    descriptorVersion?: number;
    descriptorSize?: number;
    descriptorCount?: number;
    mapKey?: string;
    mapRuntimeAddress?: string;
    captureAttempts?: number;
    totalBytes?: number;
    usableBytes?: number;
    highestPhysicalAddress?: string;
    regions: InuMemoryMapRegion[];
    categories: InuMemoryMapCategorySummary[];
    reservations: InuMemoryReservation[];
    message?: string;
    error?: string;
}



export type InuInterruptMechanism = 'none' | 'io-apic' | 'msi' | 'msi-x' | 'local-apic' | 'x2apic';
export type InuInterruptVectorKind = 'exception' | 'dynamic' | 'system';

export interface InuInterruptVectorInfo {
    vector: number;
    hex: string;
    kind: InuInterruptVectorKind;
    allocated: boolean;
    callback?: string;
    cookie?: string;
    exceptionName?: string;
    breakOnException?: boolean;
}
export interface InuInterruptRouteInfo {
    handle: string;
    vector: number;
    mechanism: InuInterruptMechanism;
    device: number;
    source: number;
    targetProcessor: number;
    direct: boolean;
    pci?: string;
    cookie?: string;
}
export interface InuIoApicInfo {
    index: number;
    mappedAddress: string;
    baseGsi: number;
    maximumGsi: number;
    pinCount: number;
}
export interface InuLocalApicRegister {
    name: string;
    offset: string;
    value?: string;
}
export interface InuInterruptSnapshot {
    success: boolean;
    active: boolean;
    paused: boolean;
    capturedAtUtc: string;
    dispatchInitialized?: boolean;
    brokerInitialized?: boolean;
    localApic?: boolean;
    ioApic?: boolean;
    x2Apic?: boolean;
    msi?: boolean;
    msiX?: boolean;
    localApicBase?: string;
    routeCount?: number;
    routeCapacity?: number;
    ioApicCount?: number;
    allocatedDynamicVectors?: number;
    vectors: InuInterruptVectorInfo[];
    routes: InuInterruptRouteInfo[];
    ioApics: InuIoApicInfo[];
    localApicRegisters: InuLocalApicRegister[];
    message?: string;
    error?: string;
}



export type InuSyscallAbi = 'inu-get' | 'inu-set' | 'inu-event' | 'linux' | 'windows-nt';
export type InuSyscallSource = 'builtin' | 'registered';

export interface InuSyscallEntry {
    abi: InuSyscallAbi;
    number: number;
    encoded?: string;
    name: string;
    source: InuSyscallSource;
    registered: boolean;
    handlerAddress?: string;
    sourcePath?: string;
    line?: number;
    description?: string;
}

export interface InuSyscallSnapshot {
    success: boolean;
    active: boolean;
    paused: boolean;
    capturedAtUtc: string;
    configuredModel?: SyscallModel;
    initialized?: boolean;
    smapEnabled?: boolean;
    configuredProcessors?: number;
    syscallStackBase?: string;
    syscallStackTop?: string;
    syscallStackBytes?: number;
    registrySlots: number;
    entries: InuSyscallEntry[];
    registeredCounts: Record<InuSyscallAbi, number>;
    message?: string;
    error?: string;
}


export type InuDiskImageOrigin = 'os' | 'sdk';
export type InuPartitionScheme = 'gpt' | 'mbr' | 'none' | 'unknown';

export interface InuDiskImageDescriptor {
    id: string;
    name: string;
    path: string;
    origin: InuDiskImageOrigin;
    sizeBytes: number;
    modifiedUtc: string;
    formatHint: string;
}

export interface InuDiskPartition {
    index: number;
    scheme: 'gpt' | 'mbr';
    name: string;
    type: string;
    typeGuid?: string;
    uniqueGuid?: string;
    firstLba: string;
    lastLba: string;
    offsetBytes: number;
    sizeBytes: number;
    bootable: boolean;
}

export interface InuDiskVolume {
    partitionIndex: number;
    fileSystem: string;
    label?: string;
    bytesPerSector?: number;
    sectorsPerCluster?: number;
    totalSectors?: number;
    fatCount?: number;
    sectorsPerFat?: number;
    rootCluster?: number;
    freeClusters?: number;
}

export interface InuDiskEntry {
    path: string;
    parentPath: string;
    name: string;
    directory: boolean;
    sizeBytes: number;
    firstCluster: number;
    partitionIndex: number;
    attributes: string[];
}

export interface InuDiskImageInspection {
    success: boolean;
    image?: InuDiskImageDescriptor;
    scheme: InuPartitionScheme;
    sectorSize: number;
    protectiveMbr: boolean;
    diskGuid?: string;
    partitions: InuDiskPartition[];
    volumes: InuDiskVolume[];
    entries: InuDiskEntry[];
    entryCount: number;
    truncated: boolean;
    message?: string;
    error?: string;
}

export interface InuDiskReadResult {
    success: boolean;
    imagePath: string;
    source: 'disk' | 'file';
    entryPath?: string;
    offset: number;
    length: number;
    totalLength?: number;
    bytes: number[];
    error?: string;
}


export interface InuSdkReferenceSymbol {
    name: string;
    namespace: string;
    project: string;
    assembly: string;
}

export interface InuSdkReferenceSyncResult {
    success: boolean;
    projectFile?: string;
    references: string[];
    namespaces: string[];
    ambiguous: string[];
    error?: string;
}

export interface InuProjectService {
    listSdkReferenceSymbols(prefix?: string): Promise<InuSdkReferenceSymbol[]>;
    synchronizeSdkReferences(sourcePath: string, sourceText: string): Promise<InuSdkReferenceSyncResult>;
    materializeSdkLibraryForSymbol(sourcePath: string, symbolName: string): Promise<InuProjectResult>;
    getSdkApiSiteUrl(): Promise<string>;
    listOperatingSystems(): Promise<InuOperatingSystem[]>;
    getDefaultOperatingSystemLocation(): Promise<string>;
    nextDefaultOperatingSystemName(baseName: string, location?: string): Promise<string>;
    removeOperatingSystemFromList(osId: string): Promise<InuProjectResult>;
    deleteOperatingSystemSource(osId: string): Promise<InuProjectResult>;
    createProject(configuration: InuProjectConfiguration): Promise<InuProjectResult>;
    getProjectGenerationProgress(): Promise<number>;
    readProjectConfiguration(projectPath: string): Promise<InuConfigurationResult>;
    inspectDeviceTree(projectPath: string): Promise<InuDeviceTreeSnapshot>;
    reconfigureProject(projectPath: string, configuration: InuProjectConfiguration): Promise<InuProjectResult>;
    refreshOperatingSystem(projectPath: string): Promise<InuProjectResult>;
    runOperatingSystem(projectPath: string, mode: InuRunMode, breakpoints?: InuBreakpointRequest[], exceptionBreakpoints?: InuExceptionBreakpointSettings): Promise<InuRunResult>;
    stopOperatingSystem(sessionId: string): Promise<InuRunResult>;
    readRunOutput(sessionId: string, offset: number): Promise<InuRunOutput>;
    runSdkCommand(projectPath: string, command: InuSdkCommand): Promise<InuSdkCommandRunResult>;
    readSdkCommandOutput(runId: string, offset: number): Promise<InuSdkCommandOutput>;
    readTraceSnapshot(projectPath: string): Promise<InuTraceSnapshot>;
    saveTrace(projectPath: string): Promise<InuTraceSaveResult>;
    resetTrace(projectPath: string): Promise<InuTraceSnapshot>;
    readProfilerSnapshot(projectPath: string): Promise<InuProfilerSnapshot>;
    resetProfiler(projectPath: string): Promise<InuProfilerSnapshot>;
    debugState(sessionId: string): Promise<InuDebugState>;
    debugCommand(sessionId: string, command: InuDebugCommand): Promise<InuDebugState>;
    toggleBreakpoint(sessionId: string, sourcePath: string, line: number, condition?: string, hitCondition?: string): Promise<InuBreakpointResult>;
    updateBreakpoint(sessionId: string, breakpoint: InuBreakpointRequest): Promise<InuBreakpointResult>;
    evaluateExpression(sessionId: string, expression: string): Promise<InuExpressionResult>;
    readMemoryRange(sessionId: string, addressExpression: string, length: number): Promise<InuMemoryReadResult>;
    inspectPageTable(sessionId: string, addressExpression: string): Promise<InuPageTableInspection>;
    inspectHeap(sessionId: string): Promise<InuHeapSnapshot>;
    captureCrashDump(sessionId: string, reason?: string): Promise<InuCrashDumpResult>;
    listCrashDumps(projectPath: string): Promise<InuCrashDumpSummary[]>;
    loadCrashDump(dumpPath: string): Promise<InuCrashDumpResult>;
    configureExceptionBreakpoints(sessionId: string, settings: InuExceptionBreakpointSettings): Promise<InuDebugState>;
    selectExecutionContext(sessionId: string, threadId: string): Promise<InuDebugState>;
    analyzeOperatingSystem(projectPath: string): Promise<InuAnalyzerSnapshot>;
    listBinaries(projectPath: string): Promise<InuBinaryDescriptor[]>;
    inspectBinary(projectPath: string, binaryPath: string, symbolFilter?: string): Promise<InuBinaryInspection>;
    inspectMemoryMap(projectPath: string): Promise<InuMemoryMapSnapshot>;
    inspectInterrupts(projectPath: string): Promise<InuInterruptSnapshot>;
    inspectSyscalls(projectPath: string): Promise<InuSyscallSnapshot>;
    listDiskImages(projectPath: string): Promise<InuDiskImageDescriptor[]>;
    inspectDiskImage(projectPath: string, imagePath: string): Promise<InuDiskImageInspection>;
    readDiskImage(projectPath: string, imagePath: string, offset: number, length: number): Promise<InuDiskReadResult>;
    readDiskImageEntry(projectPath: string, imagePath: string, entryPath: string, offset: number, length: number): Promise<InuDiskReadResult>;
    listTargets(projectPath: string): Promise<InuTargetState>;
    getActiveTarget(projectPath: string): Promise<InuTargetProfile | undefined>;
    probePhysicalDebugger(projectPath: string, targetId?: string): Promise<InuPhysicalDebuggerProbe>;
    saveTarget(projectPath: string, target: InuTargetProfile): Promise<InuTargetMutationResult>;
    deleteTarget(projectPath: string, targetId: string): Promise<InuTargetMutationResult>;
    setActiveTarget(projectPath: string, targetId: string): Promise<InuTargetMutationResult>;
    listDrivers(projectPath: string): Promise<InuDriverDescriptor[]>;
    createDriver(projectPath: string, request: InuCreateDriverRequest): Promise<InuCreateDriverResult>;
    listTests(projectPath: string): Promise<InuTestDescriptor[]>;
    runTest(projectPath: string, testId: string): Promise<InuTestRunResult>;
    readTestOutput(runId: string, offset: number): Promise<InuTestOutput>;
    getHardwareMatrixPlan(projectPath: string, preset: InuHardwareMatrixPreset): Promise<InuHardwareMatrixPlan>;
    runHardwareMatrix(projectPath: string, preset: InuHardwareMatrixPreset, mode: InuRunMode): Promise<InuHardwareMatrixRunResult>;
    readHardwareMatrixOutput(runId: string, offset: number): Promise<InuHardwareMatrixOutput>;
}

