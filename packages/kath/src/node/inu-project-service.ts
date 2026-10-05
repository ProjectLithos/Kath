import { injectable } from 'inversify';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import * as net from 'net';
import { pathToFileURL } from 'url';
import { InuOsRegistry } from './inu-os-registry';
import {
    InuOperatingSystem,
    InuConfigurationResult,
    InuProjectConfiguration,
    InuProjectResult,
    InuRunMode,
    InuSdkCommand,
    InuSdkCommandRunResult,
    InuSdkCommandOutput,
    InuDebugCommand,
    InuDebugState,
    InuDebugFrame,
    InuDebugRegister,
    InuDebugExecutionContext,
    InuDebugVariable,
    InuDisassemblyInstruction,
    InuExceptionBreakpointSettings,
    InuBreakpointRequest,
    InuExpressionResult,
    InuMemoryReadResult,
    InuPageTableInspection,
    InuPageTableEntry,
    InuHeapSnapshot,
    InuHeapBlock,
    InuCrashDumpSummary,
    InuCrashDumpResult, InuCrashDumpPanic, InuCrashDumpDriverState, InuCrashDumpModule, InuCrashDumpProcess, InuCrashDumpDocument,
    InuBreakpointResult,
    InuRunOutput,
    InuRunResult,
    InuTraceEvent,
    InuBootStage,
    InuTraceSnapshot,
    InuTraceSaveResult,
    InuProfilerSnapshot,
    InuProfilerFunction,
    InuProfilerCpu,
    InuProfilerCounter,
    InuDriverDescriptor,
    InuDriverCapability,
    InuDriverManifest,
    InuCreateDriverRequest,
    InuCreateDriverResult,
    InuTestDescriptor,
    InuTestRunResult,
    InuTestOutput,
    InuHardwareMatrixPreset,
    InuHardwareMatrixCase,
    InuHardwareMatrixPlan,
    InuHardwareValidationCoverage,
    InuHardwareMatrixRunResult,
    InuHardwareMatrixOutput,
    InuTargetProfile,
    InuPhysicalDebuggerProbe,
    InuTargetState,
    InuTargetMutationResult,
    InuAnalyzerSnapshot,
    InuAnalyzerDiagnostic,
    InuBinaryDescriptor,
    InuBinaryInspection,
    InuBinarySection,
    InuBinarySymbol,
    InuMemoryMapSnapshot,
    InuMemoryMapRegion,
    InuInterruptSnapshot,
    InuInterruptVectorInfo,
    InuInterruptMechanism,
    InuSyscallSnapshot,
    InuSyscallEntry,
    InuSyscallAbi,
    InuMemoryRegionCategory,
    InuDiskImageDescriptor,
    InuDiskImageInspection,
    InuDiskPartition,
    InuDiskVolume,
    InuDiskEntry,
    InuDiskReadResult,
    InuDeviceBus,
    InuDeviceTreeNode,
    InuDeviceTreeSnapshot,
    InuProjectService
} from '../common/inu-protocol';

import { KATH_ROOT, INU_SDK_ROOT, KATH_VERSION } from './inu-environment';
import { GdbRspClient } from './inu-debug-support';
import { GeneratedProject } from './inu-project-generation';
import { InuRuntimeDebugSupport } from './inu-runtime-debug-support';
import { RunSession, SourceBreakpoint } from './inu-debug-types';
import { InuDiskImageService } from './inu-disk-image-service';

@injectable()
export class InuProjectServiceImpl extends InuRuntimeDebugSupport implements InuProjectService {
    protected readonly osRegistry = new InuOsRegistry();
    protected readonly diskImageService = new InuDiskImageService(INU_SDK_ROOT, projectRoot => this.isOperatingSystemPath(projectRoot));
    protected readonly runSessions = new Map<string, RunSession>();
    protected readonly testRuns = new Map<string, { output: string; complete: boolean; exitCode?: number; error?: string }>();
    protected readonly sdkCommandRuns = new Map<string, { output: string; complete: boolean; exitCode?: number; error?: string }>();
    protected readonly hardwareMatrixRuns = new Map<string, { output: string; complete: boolean; exitCode?: number; error?: string; cases: InuHardwareMatrixCase[]; coverage: InuHardwareValidationCoverage[] }>();
    protected readonly telemetryArchives = new Map<string, { trace: InuTraceSnapshot; profiler: InuProfilerSnapshot }>();
    protected projectGenerationPercent = 0;

    async getProjectGenerationProgress(): Promise<number> {
        return this.projectGenerationPercent;
    }

    async getSdkApiSiteUrl(): Promise<string> {
        const indexPath = path.join(INU_SDK_ROOT, 'docs', 'site', 'index.html');
        await fs.access(indexPath);
        return pathToFileURL(indexPath).toString();
    }

    async getDefaultOperatingSystemLocation(): Promise<string> {
        return this.osRegistry.getDefaultLocation();
    }

    async nextDefaultOperatingSystemName(baseName: string, location?: string): Promise<string> {
        return this.osRegistry.nextDefaultOperatingSystemName(baseName, location);
    }

    async listOperatingSystems(): Promise<InuOperatingSystem[]> {
        // Listing OSes is read-only. Do not refresh/copy the SDK bridge for every registered OS here:
        // that work can take tens of seconds and made Generate OS sit at 100% while unrelated
        // projects were recursively rewritten. The authoritative bridge is refreshed on open/run/build.
        return this.osRegistry.listOperatingSystems();
    }

    async removeOperatingSystemFromList(osId: string): Promise<InuProjectResult> {
        try {
            const registered = await this.osRegistry.resolveProjectById(osId);
            const projectRoot = this.requireOperatingSystemRoot(registered.location);
            await fs.access(path.join(projectRoot, 'Inu.json'));
            await this.osRegistry.hideProjectById(osId);
            return { success: true, projectPath: projectRoot };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async deleteOperatingSystemSource(osId: string): Promise<InuProjectResult> {
        try {
            // Deletion identity is the stable ID in Kath's local OS registry. Resolve that ID
            // to its exact registered location; never infer a target from name, list position,
            // instance number, current workspace, or a newly scanned folder.
            const registered = await this.osRegistry.resolveProjectById(osId);
            const projectRoot = this.requireOperatingSystemRoot(registered.location);
            const configurationPath = path.join(projectRoot, 'Inu.json');
            await fs.access(configurationPath);

            // Cancel the entire build/launch tree, QEMU PID, serial transport and debugger
            // before deleting. Killing only a direct QEMU child leaves Windows handles open.
            for (const [sessionId, session] of this.runSessions) {
                if (path.resolve(session.projectRoot).toLowerCase() !== projectRoot.toLowerCase()) continue;
                const stopped = await this.stopOperatingSystem(sessionId);
                if (!stopped.success) throw new Error(stopped.error ?? 'Could not stop the operating system before deletion.');
            }

            // Delete the exact registered source root in place. A required rename can fail
            // while the IDE has the folder open and previously prevented any source removal.
            try {
                await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 16, retryDelay: 125 });
            } catch {
                if (await this.pathExists(projectRoot)) {
                    await this.makeTreeWritable(projectRoot);
                    await fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 16, retryDelay: 125 });
                }
            }
            if (await this.pathExists(projectRoot)) {
                return { success: false, error: `Deletion did not completely remove ${projectRoot} from disk.` };
            }
            await this.osRegistry.forgetDeletedProjectById(osId);
            return { success: true, projectPath: projectRoot };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    protected async pathExists(candidate: string): Promise<boolean> {
        try { await fs.lstat(candidate); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    }

    protected async makeTreeWritable(root: string): Promise<void> {
        const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
        for (const entry of entries) {
            const item = path.join(root, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) await this.makeTreeWritable(item);
            await fs.chmod(item, 0o700).catch(() => undefined);
        }
        await fs.chmod(root, 0o700).catch(() => undefined);
    }

    async inspectDeviceTree(projectPath: string): Promise<InuDeviceTreeSnapshot> {
        const result = await this.readProjectConfiguration(projectPath);
        if (!result.success || !result.configuration) {
            return { schemaVersion: 1, generation: 0, source: 'configuration', roots: [], counts: { total: 0, pci: 0, usb: 0, acpi: 0, platform: 0, virtual: 0, logical: 0 }, message: result.error || 'Open a Inu operating system to inspect its device tree.' };
        }
        const c = result.configuration;
        let sequence = 1;
        const counts = { total: 0, pci: 0, usb: 0, acpi: 0, platform: 0, virtual: 0, logical: 0 };
        const classify = (name: string, fallback: InuDeviceBus = 'platform'): InuDeviceBus => {
            const text = name.toLowerCase();
            if (text.includes('usb') || text.includes('xhci') || text.includes('ehci') || text.includes('hid')) return 'usb';
            if (text.includes('pci') || text.includes('pcie') || text.includes('nvme') || text.includes('ahci') || text.includes('sata') || text.includes('e1000') || text.includes('rtl') || text.includes('i219') || text.includes('i225')) return 'pci';
            if (text.includes('acpi') || text.includes('hpet') || text.includes('fadt') || text.includes('madt') || text.includes('mcfg')) return 'acpi';
            if (text.includes('virtio') || text.includes('qemu')) return 'virtual';
            return fallback;
        };
        const node = (bus: InuDeviceBus, name: string, children: InuDeviceTreeNode[] = [], parentId?: string): InuDeviceTreeNode => {
            const id = `device-${sequence++}`;
            counts.total++; counts[bus]++;
            const n: InuDeviceTreeNode = { id, parentId, bus, name, state: 'discovered', children: [] };
            n.children = children.map(child => ({ ...child, parentId: id }));
            return n;
        };
        const childNodes = (items: string[], fallback: InuDeviceBus = 'platform') => items.map(item => node(classify(item, fallback), item));
        const platformChildren: InuDeviceTreeNode[] = [
            node('platform', `CPU — ${c.targetArchitecture}`),
            node('logical', c.smp ? 'SMP / per-CPU topology' : 'Single CPU topology'),
            node('logical', `Interrupt model — ${c.interruptModel}`),
            ...childNodes(c.timers, 'platform')
        ];
        const roots: InuDeviceTreeNode[] = [
            node('platform', 'Platform devices', platformChildren),
            node('pci', 'PCI / PCIe devices', childNodes([...c.drivers, ...c.storageControllers, ...c.networkDrivers].filter(x => classify(x) === 'pci'), 'pci')),
            node('usb', 'USB devices', childNodes([...c.drivers, ...c.input].filter(x => classify(x) === 'usb'), 'usb')),
            node('acpi', 'ACPI devices', childNodes([...c.drivers, ...c.timers].filter(x => classify(x) === 'acpi'), 'acpi')),
            node('virtual', 'Virtual devices', childNodes([...c.drivers, ...c.graphics, ...c.networkDrivers, ...c.storageControllers].filter(x => classify(x) === 'virtual'), 'virtual')),
            node('logical', 'Logical devices', [
                node('logical', `Network stack — ${c.networkStack}`),
                ...childNodes(c.graphics.filter(x => classify(x) !== 'virtual'), 'logical'),
                ...childNodes(c.input.filter(x => classify(x) !== 'usb'), 'logical'),
                ...(c.audio === 'none' ? [] : [node('logical', `Audio — ${c.audio}`)])
            ])
        ];
        const fixParents = (parent: InuDeviceTreeNode): void => { for (const child of parent.children) { child.parentId = parent.id; fixParents(child); } };
        roots.forEach(fixParents);
        return { schemaVersion: 1, generation: Date.now(), source: 'configuration', roots, counts };
    }

    async listDrivers(projectPath: string): Promise<InuDriverDescriptor[]> {
        const projectRoot = path.resolve(projectPath);
        if (!this.isOperatingSystemPath(projectRoot)) return [];
        const result: InuDriverDescriptor[] = [];
        const configurationResult = await this.readProjectConfiguration(projectRoot);
        const configured = configurationResult.success && configurationResult.configuration
            ? [...configurationResult.configuration.drivers, ...configurationResult.configuration.storageControllers, ...configurationResult.configuration.networkDrivers, ...configurationResult.configuration.input, ...configurationResult.configuration.graphics]
            : [];
        for (const name of Array.from(new Set(configured)).sort((a, b) => a.localeCompare(b))) {
            result.push({ id: `configured:${name.toLowerCase()}`, name, projectPath: projectRoot, source: 'configured', kind: 'configured', configured: true });
        }
        const roots = [path.join(projectRoot, 'Drivers'), path.join(projectRoot, 'Kernel', 'Drivers'), path.join(projectRoot, 'DriverProjects')];
        for (const driversRoot of roots) {
            const entries = await fs.readdir(driversRoot, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const folder = path.join(driversRoot, entry.name);
                const manifestPath = path.join(folder, 'Inu.Driver.json');
                const projectFiles = (await fs.readdir(folder).catch(() => [] as string[])).filter(name => name.toLowerCase().endsWith('.csproj'));
                if (!projectFiles.length) continue;
                let manifest: InuDriverManifest | undefined;
                try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as InuDriverManifest; } catch { }
                const name = manifest?.name || entry.name;
                result.push({ id: `os:${folder.toLowerCase()}`, name, projectPath: path.join(folder, projectFiles[0]), manifestPath: manifest ? manifestPath : undefined, source: 'os', kind: manifest?.kind ?? 'platform', configured: configured.some(item => item.toLowerCase() === name.toLowerCase()), manifest });
            }
        }
        const unique = new Map<string, InuDriverDescriptor>();
        for (const item of result) unique.set(`${item.source}:${item.name.toLowerCase()}`, item);
        return [...unique.values()].sort((a, b) => Number(b.source === 'os') - Number(a.source === 'os') || a.name.localeCompare(b.name));
    }

    async createDriver(projectPath: string, request: InuCreateDriverRequest): Promise<InuCreateDriverResult> {
        try {
            const projectRoot = path.resolve(projectPath);
            if (!this.isOperatingSystemPath(projectRoot)) return { success: false, error: 'Driver projects can only be created inside an open Inu OS workspace.' };
            await fs.access(path.join(projectRoot, 'Inu.json'));
            const safeName = this.safeSegment((request.name || '').trim());
            if (!safeName || safeName.length < 2) return { success: false, error: 'Enter a driver name containing at least two letters or numbers.' };
            const target = path.join(projectRoot, 'DriverProjects', safeName);
            const relative = path.relative(projectRoot, target);
            if (relative.startsWith('..') || path.isAbsolute(relative)) return { success: false, error: 'Invalid driver project path.' };
            try { await fs.access(target); return { success: false, error: `Driver project ${safeName} already exists.` }; } catch { }
            await fs.mkdir(target, { recursive: true });
            const sdkContract = await this.readSdkContractVersions();
            const capabilities = Array.from(new Set((request.capabilities ?? []).filter(value => ['mmio','pio','interrupts','msi','msix','dma','pci-config','physical-memory','timers','networking','filesystem'].includes(value))));
            const manifest: InuDriverManifest = { schemaVersion: 3, id: `inu.driver.${safeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: safeName, kind: request.kind, version: '0.1.0', sdkApiVersion: sdkContract.apiVersion, driverAbiVersion: sdkContract.driverAbiVersion, architecture: 'x64', minimumInuVersion: sdkContract.sdkVersion, ids: [], dependencies: [], capabilities, permissions: capabilities, signing: { state: 'unsigned' }, description: request.description?.trim() || undefined };
            if (request.kind === 'pci') { manifest.vendorId = this.normaliseHexId(request.vendorId); manifest.deviceId = this.normaliseHexId(request.deviceId); }
            if (request.kind === 'usb') { manifest.usbVendorId = this.normaliseHexId(request.usbVendorId); manifest.usbProductId = this.normaliseHexId(request.usbProductId); }
            if (request.kind === 'virtio' && Number.isInteger(request.virtioDeviceId)) manifest.virtioDeviceId = Math.max(0, Number(request.virtioDeviceId));
            const manifestPath = path.join(target, 'Inu.Driver.json');
            const projectFile = path.join(target, `${safeName}.csproj`);
            await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
            await fs.writeFile(projectFile, this.driverProjectFile(safeName), 'utf8');
            await fs.writeFile(path.join(target, 'Driver.cs'), this.driverSource(safeName, manifest), 'utf8');
            await fs.writeFile(path.join(target, 'README.md'), this.driverReadme(manifest), 'utf8');
            let testProjectPath: string | undefined;
            if (request.createTestProject) {
                const testDir = path.join(projectRoot, 'Tests', `${safeName}.Driver.Tests`);
                await fs.mkdir(testDir, { recursive: true });
                testProjectPath = path.join(testDir, `${safeName}.Driver.Tests.csproj`);
                const relDriver = path.relative(testDir, projectFile).replace(/\\/g, '/');
                await fs.writeFile(testProjectPath, this.driverTestProjectFile(safeName, relDriver), 'utf8');
                await fs.writeFile(path.join(testDir, 'Program.cs'), this.driverTestSource(safeName), 'utf8');
            }
            return { success: true, projectPath: projectFile, manifestPath, testProjectPath };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    }

    protected targetFile(projectRoot: string): string { return path.join(projectRoot, 'Inu.Targets.json'); }

    protected defaultTargetState(configuration?: InuProjectConfiguration): InuTargetState {
        const architecture = configuration?.targetArchitecture ?? 'x86_64';
        const target: InuTargetProfile = {
            schemaVersion: 1,
            id: `qemu-${architecture}`,
            name: architecture === 'x86_64' ? 'QEMU x64' : `QEMU ${architecture}`,
            kind: 'qemu', architecture,
            qemu: { cpuCount: configuration?.qemuCpuCount ?? 4, memoryMiB: 512, machine: architecture === 'x86_64' ? 'q35' : 'virt', accelerator: 'tcg', display: 'sdl' }
        };
        return { schemaVersion: 1, activeTargetId: target.id, targets: [target] };
    }

    protected async readTargetState(projectRoot: string): Promise<InuTargetState> {
        const config = await this.readProjectConfiguration(projectRoot);
        const fallback = this.defaultTargetState(config.configuration);
        try {
            const parsed = JSON.parse(await fs.readFile(this.targetFile(projectRoot), 'utf8')) as InuTargetState;
            if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.targets) || parsed.targets.length === 0) return fallback;
            const configuredCpuCount = config.configuration?.qemuCpuCount ?? 4;
            const targets = parsed.targets.filter(item => item && item.schemaVersion === 1 && typeof item.id === 'string' && typeof item.name === 'string').map(item =>
                item.kind === 'qemu' && item.qemu ? { ...item, qemu: { ...item.qemu, cpuCount: configuredCpuCount } } : item
            );
            if (targets.length === 0) return fallback;
            const activeTargetId = targets.some(item => item.id === parsed.activeTargetId) ? parsed.activeTargetId : targets[0].id;
            const synchronized = { schemaVersion: 1 as const, activeTargetId, targets };
            if (JSON.stringify(synchronized) !== JSON.stringify(parsed)) await fs.writeFile(this.targetFile(projectRoot), JSON.stringify(synchronized, null, 2) + '\n', 'utf8').catch(() => undefined);
            return synchronized;
        } catch {
            await fs.writeFile(this.targetFile(projectRoot), JSON.stringify(fallback, null, 2) + '\n', 'utf8').catch(() => undefined);
            return fallback;
        }
    }

    protected async syncConfiguredQemuCpuCount(projectRoot: string, configuration: InuProjectConfiguration): Promise<void> {
        const targetPath = this.targetFile(projectRoot);
        let state = this.defaultTargetState(configuration);
        try {
            const parsed = JSON.parse(await fs.readFile(targetPath, 'utf8')) as InuTargetState;
            if (parsed.schemaVersion === 1 && Array.isArray(parsed.targets) && parsed.targets.length > 0) {
                const targets = parsed.targets.map(item => item.kind === 'qemu' && item.qemu
                    ? { ...item, qemu: { ...item.qemu, cpuCount: configuration.qemuCpuCount } }
                    : item);
                state = { schemaVersion: 1, activeTargetId: targets.some(item => item.id === parsed.activeTargetId) ? parsed.activeTargetId : targets[0].id, targets };
            }
        } catch { }
        await fs.writeFile(targetPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    }

    protected validateTarget(target: InuTargetProfile): string | undefined {
        if (!target || target.schemaVersion !== 1) return 'Unsupported Inu target schema.';
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(target.id || '')) return 'Target ID must contain only letters, numbers, dot, underscore and dash.';
        if (!(target.name || '').trim()) return 'Target name is required.';
        if (!['qemu','physical','remote'].includes(target.kind)) return 'Unsupported target kind.';
        if (!['x86_64','arm64','riscv64'].includes(target.architecture)) return 'Unsupported target architecture.';
        if (target.kind === 'qemu') {
            if (!target.qemu) return 'QEMU settings are required.';
            if (!Number.isInteger(target.qemu.cpuCount) || target.qemu.cpuCount < 1 || target.qemu.cpuCount > 256) return 'QEMU CPU count must be between 1 and 256.';
            if (!Number.isInteger(target.qemu.memoryMiB) || target.qemu.memoryMiB < 64 || target.qemu.memoryMiB > 1048576) return 'QEMU RAM must be between 64 MiB and 1 TiB.';
        }
        if (target.kind === 'physical') {
            if (!target.physical) return 'Physical debugger settings are required.';
            if (!(target.physical.gdbHost || '').trim()) return 'Physical GDB host is required.';
            if (!Number.isInteger(target.physical.gdbPort) || target.physical.gdbPort < 1 || target.physical.gdbPort > 65535) return 'Physical GDB port must be between 1 and 65535.';
            if (target.physical.baudRate !== undefined && (!Number.isInteger(target.physical.baudRate) || target.physical.baudRate < 1200 || target.physical.baudRate > 4000000)) return 'Physical serial baud rate must be between 1200 and 4000000.';
        }
        return undefined;
    }

    async analyzeOperatingSystem(projectPath: string): Promise<InuAnalyzerSnapshot> {
        const projectRoot = path.resolve(projectPath);
        const diagnostics: InuAnalyzerDiagnostic[] = [];
        let filesAnalyzed = 0;
        const activeTarget = await this.getActiveTarget(projectRoot).catch(() => undefined);
        if (!this.isOperatingSystemPath(projectRoot)) {
            return { schemaVersion: 1, analyzedAtUtc: new Date().toISOString(), projectPath: projectRoot, filesAnalyzed: 0, diagnostics: [], errorCount: 0, warningCount: 0, infoCount: 0 };
        }

        const add = (code: string, severity: InuAnalyzerDiagnostic['severity'], category: InuAnalyzerDiagnostic['category'], message: string, filePath: string, line: number, column: number, rule: string): void => {
            diagnostics.push({ code, severity, category, message, filePath, line, column, rule });
        };
        const location = (text: string, index: number): { line: number; column: number } => {
            const before = text.slice(0, Math.max(0, index));
            const lines = before.split(/\r?\n/);
            return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
        };
        const reportPattern = (text: string, regex: RegExp, filePath: string, code: string, severity: InuAnalyzerDiagnostic['severity'], category: InuAnalyzerDiagnostic['category'], message: string, rule: string): void => {
            regex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = regex.exec(text))) {
                const loc = location(text, match.index);
                add(code, severity, category, message, filePath, loc.line, loc.column, rule);
                if (!regex.global) break;
            }
        };
        const sourceFiles: string[] = [];
        const scan = async (directory: string): Promise<void> => {
            const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
            for (const entry of entries) {
                if (entry.name === 'bin' || entry.name === 'obj' || entry.name === '.inu' || entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'Sdk' || entry.name === 'SDK') continue;
                const full = path.join(directory, entry.name);
                if (entry.isDirectory()) await scan(full);
                else if (entry.isFile() && entry.name.toLowerCase().endsWith('.cs')) sourceFiles.push(full);
            }
        };
        await scan(projectRoot);

        for (const filePath of sourceFiles) {
            let text: string;
            try { text = await fs.readFile(filePath, 'utf8'); } catch { continue; }
            filesAnalyzed++;
            const relative = path.relative(projectRoot, filePath).replace(/\\/g, '/');
            const lower = relative.toLowerCase();
            const inKernel = lower === 'kernel/kernel.cs' || lower.startsWith('kernel/');
            const inDriver = lower.startsWith('drivers/') || lower.startsWith('driverprojects/') || lower.includes('/drivers/');
            const inUserland = lower.startsWith('userland/') || lower.includes('/userland/');
            const inArchitectureLayer = lower.includes('/arch/') || lower.includes('/architecture/') || lower.includes('/hal/') || lower.startsWith('arch/') || lower.startsWith('hal/');

            if (inUserland) {
                reportPattern(text, /\busing\s+Inu\.Kernel(?:\.|\s*;)/g, filePath, 'NOA1001', 'error', 'boundary', 'Userland code must not reference Inu.Kernel assemblies directly; use a syscall/service contract.', 'kernel-userland-boundary');
                reportPattern(text, /\bunsafe\b|\b(?:byte|sbyte|short|ushort|int|uint|long|ulong|void)\s*\*/g, filePath, 'NOA1002', 'warning', 'userland-safety', 'Unsafe/pointer code in userland bypasses normal Inu isolation expectations and should be justified behind a supported capability/API.', 'unsafe-userland');
            }
            if (inKernel || inDriver) {
                reportPattern(text, /\bThread\.Sleep\s*\(|\bTask\.Delay\s*\(/g, filePath, 'NOA2001', 'error', 'kernel-safety', 'Blocking managed sleep/delay is not valid in kernel or driver code; use Inu timers/scheduler primitives.', 'blocking-kernel-wait');
                reportPattern(text, /\bthrow\s+(?:new\s+)?[A-Za-z_]/g, filePath, 'NOA2002', 'warning', 'kernel-safety', 'Kernel/driver code should return an explicit status/error contract instead of relying on managed exceptions in normal failure paths.', 'kernel-exception-path');
                reportPattern(text, /\basync\s+(?:System\.)?(?:Threading\.Tasks\.)?Task\b|\basync\s+Task\b/g, filePath, 'NOA2003', 'warning', 'kernel-safety', 'Managed async/Task execution is not part of the freestanding kernel scheduling contract unless an SDK subsystem explicitly provides it.', 'kernel-managed-async');
            }
            if (!inArchitectureLayer && !inDriver && (inKernel || lower.startsWith('services/'))) {
                reportPattern(text, /\b(?:PortIO|IoPort|In8|In16|In32|Out8|Out16|Out32)\b/g, filePath, 'NOA3001', 'error', 'architecture', 'Direct I/O-port access leaked outside the architecture/HAL/driver boundary.', 'hardware-access-boundary');
                reportPattern(text, /\bInu\.Arch\.(?:X64|Arm64|RiscV64)\b/g, filePath, 'NOA3002', 'warning', 'architecture', 'Architecture-specific API referenced from generic OS code; move it behind Inu architecture/HAL contracts.', 'architecture-leakage');
            }
            if (activeTarget?.architecture && activeTarget.architecture !== 'x86_64' && !inArchitectureLayer) {
                reportPattern(text, /\b(?:X64|x86_64|CPUID|MSR|CR0|CR2|CR3|CR4|APIC|x2APIC)\b/g, filePath, 'NOA3003', 'warning', 'architecture', `The active target is ${activeTarget.architecture}, but generic source contains x64-specific implementation vocabulary.`, 'active-target-architecture');
            }

            const interruptMethod = /\b(?:Interrupt|Irq|Isr|Exception)\w*\s*\([^)]*\)\s*(?:=>|\{)/gi;
            let interruptMatch: RegExpExecArray | null;
            while ((interruptMatch = interruptMethod.exec(text))) {
                const start = interruptMatch.index;
                const sample = text.slice(start, Math.min(text.length, start + 1600));
                const allocation = /\bnew\s+[A-Za-z_][A-Za-z0-9_.<>]*\s*(?:\(|\[)/.exec(sample);
                if (allocation) {
                    const loc = location(text, start + allocation.index);
                    add('NOA4001', 'warning', 'interrupt-safety', 'Allocation detected in an interrupt/IRQ/ISR/exception handler. Interrupt paths should avoid heap allocation and unbounded work.', filePath, loc.line, loc.column, 'interrupt-allocation');
                }
            }
        }

        // Driver manifests are authoritative capability declarations. Match obvious SDK surface use
        // against each driver project so undeclared hardware privileges are visible before boot.
        const driverRoot = path.join(projectRoot, 'DriverProjects');
        const driverEntries = await fs.readdir(driverRoot, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
        const capabilityUses: Array<{ capability: string; regex: RegExp; label: string }> = [
            { capability: 'mmio', regex: /\b(?:Mmio|MMIO|MapMmio|MemoryMappedIo)\b/, label: 'MMIO' },
            { capability: 'pio', regex: /\b(?:PortIO|IoPort|In8|In16|In32|Out8|Out16|Out32)\b/, label: 'port I/O' },
            { capability: 'interrupts', regex: /\b(?:Interrupt|Irq|IRQ|Isr|ISR)\b/, label: 'interrupt' },
            { capability: 'msi', regex: /\bMSI\b|\bMsi\b/, label: 'MSI' },
            { capability: 'msix', regex: /\bMSI-X\b|\bMSIX\b|\bMsiX\b|\bMsix\b/, label: 'MSI-X' },
            { capability: 'dma', regex: /\bDMA\b|\bDma\b/, label: 'DMA' },
            { capability: 'timers', regex: /\b(?:KernelTimer|TimerBroker|HighResolutionTimer)\b/, label: 'timer' },
            { capability: 'pci-config', regex: /\b(?:KernelPci\.(?:TryRead|TryWrite)|PciConfig)\b/, label: 'PCI configuration' },
            { capability: 'physical-memory', regex: /\b(?:KernelPhysicalMemory|PhysicalMemory)\b/, label: 'physical memory' },
            { capability: 'networking', regex: /\b(?:KernelNetworking|Socket|NetworkInterface)\b/, label: 'networking' },
            { capability: 'filesystem', regex: /\b(?:KernelStorage|KernelVfs|FileSystem|Filesystem)\b/, label: 'filesystem' }
        ];
        for (const entry of driverEntries) {
            if (!entry.isDirectory()) continue;
            const folder = path.join(driverRoot, entry.name);
            const manifestPath = path.join(folder, 'Inu.Driver.json');
            let manifest: InuDriverManifest | undefined;
            try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as InuDriverManifest; } catch { continue; }
            const declared = new Set(manifest.capabilities ?? []);
            const files = sourceFiles.filter(file => file.toLowerCase().startsWith((folder + path.sep).toLowerCase()));
            for (const filePath of files) {
                const text = await fs.readFile(filePath, 'utf8').catch(() => '');
                for (const use of capabilityUses) {
                    const found = use.regex.exec(text);
                    if (found && !declared.has(use.capability as any)) {
                        const loc = location(text, found.index);
                        add('NOA5001', 'error', 'driver-capability', `${manifest.name} uses ${use.label} functionality but does not declare the '${use.capability}' capability in Inu.Driver.json.`, filePath, loc.line, loc.column, 'driver-capability-declaration');
                    }
                }
                const privilegedDriverApi = /\b(?:KernelPci\.(?:TryRead|TryWrite|TryMap)|KernelPhysicalMemory\.|Native\.(?:In|Out|ReadModelSpecificRegister|WriteModelSpecificRegister)|KernelAddressSpace\.TryPhysicalToDirectMap)\b/g;
                const rawAccess = privilegedDriverApi.exec(text);
                if (rawAccess && !/\bKernelDrivers\.(?:TryGetCapabilityGrant|ValidateCapabilityGrant)\b/.test(text)) {
                    const loc = location(text, rawAccess.index);
                    add('NOA5002', 'error', 'driver-capability', `${manifest.name} calls a privileged raw kernel API without first obtaining or validating a live KernelDriverCapabilityGrant for the operation.`, filePath, loc.line, loc.column, 'driver-capability-live-grant');
                }
            }
        }

        diagnostics.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.code.localeCompare(b.code));
        return {
            schemaVersion: 1,
            analyzedAtUtc: new Date().toISOString(),
            projectPath: projectRoot,
            filesAnalyzed,
            diagnostics,
            errorCount: diagnostics.filter(item => item.severity === 'error').length,
            warningCount: diagnostics.filter(item => item.severity === 'warning').length,
            infoCount: diagnostics.filter(item => item.severity === 'info').length,
            targetArchitecture: activeTarget?.architecture
        };
    }

    async listBinaries(projectPath: string): Promise<InuBinaryDescriptor[]> {
        const projectRoot = path.resolve(projectPath);
        if (!this.isOperatingSystemPath(projectRoot)) return [];
        const result: InuBinaryDescriptor[] = [];
        const seen = new Set<string>();
        const extensions = new Set(['.bin','.efi','.exe','.dll','.obj','.lib','.pdb','.map','.a','.so']);
        const addFile = async (filePath: string, origin: 'os' | 'sdk'): Promise<void> => {
            const resolved = path.resolve(filePath);
            const key = resolved.toLowerCase(); if (seen.has(key)) return;
            const base = path.basename(resolved);
            const lower = base.toLowerCase();
            const ext = path.extname(lower);
            if (!extensions.has(ext) && lower !== 'inu.debugsymbols.json') return;
            try {
                const stat = await fs.stat(resolved); if (!stat.isFile()) return;
                const kind: InuBinaryDescriptor['kind'] = lower === 'inu.debugsymbols.json' ? 'debug-map'
                    : ext === '.pdb' ? 'pdb' : ext === '.map' ? 'map' : ext === '.lib' || ext === '.a' ? 'archive'
                    : ['.bin','.efi','.exe','.dll'].includes(ext) ? 'pe' : ext === '.obj' ? 'coff' : 'unknown';
                result.push({ id: `${origin}:${resolved.toLowerCase()}`, name: base, path: resolved, origin, kind, sizeBytes: stat.size, modifiedUtc: stat.mtime.toISOString() });
                seen.add(key);
            } catch { }
        };
        const scan = async (directory: string, origin: 'os' | 'sdk', depth: number): Promise<void> => {
            if (depth < 0 || result.length >= 600) return;
            const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
            for (const entry of entries) {
                if (result.length >= 600) break;
                const full = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '.git') continue;
                    await scan(full, origin, depth - 1);
                } else if (entry.isFile()) await addFile(full, origin);
            }
        };
        await scan(path.join(projectRoot, 'Artifacts'), 'os', 5);
        await scan(path.join(projectRoot, 'bin'), 'os', 4);
        await scan(path.join(projectRoot, 'obj'), 'os', 4);
        await scan(path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel'), 'sdk', 4);
        return result.sort((a,b) => Number(b.origin === 'os') - Number(a.origin === 'os') || a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
    }

    async inspectBinary(projectPath: string, binaryPath: string, symbolFilter = ''): Promise<InuBinaryInspection> {
        const projectRoot = path.resolve(projectPath);
        const resolved = path.resolve(binaryPath);
        const allowedRoots = [projectRoot, path.resolve(INU_SDK_ROOT, 'Artifacts')];
        if (!this.isOperatingSystemPath(projectRoot) || !allowedRoots.some(root => { const rel = path.relative(root, resolved); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); })) {
            return { success: false, sections: [], symbols: [], symbolCount: 0, truncated: false, error: 'Binary inspection is limited to the open Inu OS and bundled SDK artifacts.' };
        }
        const binaries = await this.listBinaries(projectRoot);
        const binary = binaries.find(item => path.resolve(item.path).toLowerCase() === resolved.toLowerCase());
        if (!binary) return { success: false, sections: [], symbols: [], symbolCount: 0, truncated: false, error: 'The selected artifact is no longer available.' };
        try {
            if (binary.kind === 'debug-map') return await this.inspectDebugMap(binary, symbolFilter);
            if (binary.kind === 'pdb') return await this.inspectPdb(binary, symbolFilter);
            if (binary.kind === 'map') return await this.inspectLinkerMap(binary, symbolFilter);
            return await this.inspectNativeBinary(binary, symbolFilter);
        } catch (error) {
            return { success: false, binary, sections: [], symbols: [], symbolCount: 0, truncated: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    protected binaryFilter(symbols: InuBinarySymbol[], filter: string, limit = 2000): { symbols: InuBinarySymbol[]; symbolCount: number; truncated: boolean } {
        const needle = filter.trim().toLowerCase();
        const filtered = needle ? symbols.filter(item => item.name.toLowerCase().includes(needle) || (item.sourcePath ?? '').toLowerCase().includes(needle)) : symbols;
        return { symbols: filtered.slice(0, limit), symbolCount: filtered.length, truncated: filtered.length > limit };
    }

    protected async inspectDebugMap(binary: InuBinaryDescriptor, filter: string): Promise<InuBinaryInspection> {
        const raw = JSON.parse(await fs.readFile(binary.path, 'utf8')) as any;
        const rows = Array.isArray(raw.entries) ? raw.entries : [];
        const symbols: InuBinarySymbol[] = rows.flatMap((entry: any) => {
            const address = entry.linkedAddress ?? entry.LinkedAddress;
            const sourcePath = entry.sourcePath ?? entry.SourcePath;
            const line = entry.line ?? entry.Line;
            if (!address || !sourcePath || !Number.isInteger(line)) return [];
            return [{ name: `${path.basename(String(sourcePath))}:${line}`, address: String(address), kind: 'source-line' as const, sourcePath: String(sourcePath), line: Number(line) }];
        });
        if (raw.anchor?.symbol && raw.anchor?.linkedAddress) symbols.unshift({ name: String(raw.anchor.symbol), address: String(raw.anchor.linkedAddress), kind: 'public' });
        const selected = this.binaryFilter(symbols, filter);
        return { success: true, binary, format: 'Inu Debug Symbol Map v1', architecture: 'x86_64', imageBase: raw.imageBase ? String(raw.imageBase) : undefined, sections: [], ...selected, message: 'Source-line addresses are read from Inu.DebugSymbols.json.' };
    }

    protected async inspectPdb(binary: InuBinaryDescriptor, filter: string): Promise<InuBinaryInspection> {
        const tool = path.join(INU_SDK_ROOT, '.toolchain', 'LLVM', 'bin', 'llvm-pdbutil.exe');
        if (!(await this.exists(tool))) return { success: true, binary, format: 'PDB', sections: [], symbols: [], symbolCount: 0, truncated: false, message: 'llvm-pdbutil is not installed, so PDB metadata cannot be enumerated.' };
        const output = await this.captureTool(tool, ['dump', '--publics', '--globals', binary.path]);
        const symbols: InuBinarySymbol[] = [];
        const seen = new Set<string>();
        for (const line of output.text.split(/\r?\n/)) {
            const name = line.match(/`([^`]+)`/)?.[1] ?? line.match(/name\s*=\s*([^,]+)$/i)?.[1]?.trim();
            if (!name || name.length > 500 || seen.has(name)) continue;
            const addr = line.match(/addr\s*=\s*([0-9]+):([0-9A-Fa-f]+)/i);
            const address = addr ? `${addr[1]}:${addr[2]}` : undefined;
            symbols.push({ name, address, kind: 'public' }); seen.add(name);
        }
        const selected = this.binaryFilter(symbols, filter);
        return { success: output.exitCode === 0, binary, format: 'Microsoft Program Database (PDB)', sections: [], ...selected, message: output.exitCode === 0 ? 'Public/global symbols enumerated with llvm-pdbutil.' : output.text.trim().slice(0, 500) };
    }

    protected async inspectLinkerMap(binary: InuBinaryDescriptor, filter: string): Promise<InuBinaryInspection> {
        const text = await fs.readFile(binary.path, 'utf8');
        const symbols: InuBinarySymbol[] = [];
        const re = /^\s*(?:0x)?([0-9A-Fa-f]{8,16})\s+(.+?)\s*$/gm; let m: RegExpExecArray | null;
        while ((m = re.exec(text))) { const name = m[2].trim(); if (name && name.length < 500) symbols.push({ name, address: `0x${m[1]}`, kind: 'unknown' }); }
        const selected = this.binaryFilter(symbols, filter);
        return { success: true, binary, format: 'Linker map', sections: [], ...selected };
    }

    protected async inspectNativeBinary(binary: InuBinaryDescriptor, filter: string): Promise<InuBinaryInspection> {
        const bytes = await fs.readFile(binary.path);
        const sections: InuBinarySection[] = [];
        let format = binary.kind === 'coff' ? 'COFF object' : 'Native binary';
        let architecture: string | undefined;
        let imageBase: string | undefined;
        let entryPoint: string | undefined;
        if (bytes.length >= 0x40 && bytes.readUInt16LE(0) === 0x5a4d) {
            const pe = bytes.readUInt32LE(0x3c);
            if (pe + 24 <= bytes.length && bytes.readUInt32LE(pe) === 0x00004550) {
                format = 'PE/COFF';
                const machine = bytes.readUInt16LE(pe + 4); architecture = machine === 0x8664 ? 'x86_64' : machine === 0xaa64 ? 'arm64' : machine === 0x5064 ? 'riscv64' : `machine 0x${machine.toString(16)}`;
                const sectionCount = bytes.readUInt16LE(pe + 6); const optionalSize = bytes.readUInt16LE(pe + 20); const optional = pe + 24;
                if (optional + optionalSize <= bytes.length) {
                    const magic = bytes.readUInt16LE(optional); const entryRva = bytes.readUInt32LE(optional + 16);
                    if (magic === 0x20b) { const base = bytes.readBigUInt64LE(optional + 24); imageBase = `0x${base.toString(16)}`; entryPoint = `0x${(base + BigInt(entryRva)).toString(16)}`; }
                    else if (magic === 0x10b) { const base = BigInt(bytes.readUInt32LE(optional + 28)); imageBase = `0x${base.toString(16)}`; entryPoint = `0x${(base + BigInt(entryRva)).toString(16)}`; }
                }
                const table = optional + optionalSize;
                for (let i=0;i<sectionCount;i++) { const o=table+i*40; if (o+40>bytes.length) break; const name=bytes.subarray(o,o+8).toString('ascii').replace(/\0.*$/,''); const va=bytes.readUInt32LE(o+12); const vs=bytes.readUInt32LE(o+8); const raw=bytes.readUInt32LE(o+16); const ch=bytes.readUInt32LE(o+36); sections.push({name,virtualAddress:`0x${va.toString(16)}`,virtualSize:vs,rawSize:raw,characteristics:`0x${ch.toString(16).padStart(8,'0')}`}); }
            }
        } else if (bytes.length >= 20) {
            const machine=bytes.readUInt16LE(0); architecture = machine===0x8664?'x86_64':machine===0xaa64?'arm64':undefined;
        }
        const nm = path.join(INU_SDK_ROOT, '.toolchain', 'LLVM', 'bin', 'llvm-nm.exe');
        let symbols: InuBinarySymbol[] = [];
        let message: string | undefined;
        if (await this.exists(nm)) {
            const output = await this.captureTool(nm, ['--print-size','--size-sort','--demangle', binary.path]);
            if (output.exitCode === 0) {
                for (const line of output.text.split(/\r?\n/)) {
                    const m = /^\s*([0-9A-Fa-f]+)\s+([0-9A-Fa-f]+)\s+([A-Za-z?])\s+(.+)$/.exec(line); if (!m) continue;
                    const type=m[3].toUpperCase(); const kind: InuBinarySymbol['kind'] = ['T','W'].includes(type)?'function':['B','D','R','S','G'].includes(type)?'data':'unknown';
                    symbols.push({name:m[4].trim(),address:`0x${m[1]}`,size:Number.parseInt(m[2],16),kind});
                }
            } else message = output.text.trim().slice(0,500);
        } else message = 'llvm-nm is not installed in the bundled SDK toolchain; binary headers and sections are still available.';
        const selected=this.binaryFilter(symbols,filter);
        return {success:true,binary,format,architecture,imageBase,entryPoint,sections,...selected,message};
    }

    async inspectMemoryMap(projectPath: string): Promise<InuMemoryMapSnapshot> {
        const capturedAtUtc = new Date().toISOString();
        const empty = (message: string, active = false, paused = false, error?: string): InuMemoryMapSnapshot => ({
            success: false, active, paused, capturedAtUtc, regions: [], categories: [], reservations: [], message, error
        });
        const projectRoot = path.resolve(projectPath);
        if (!this.isOperatingSystemPath(projectRoot)) return empty('Open a Inu operating system to inspect its memory map.');
        const session = this.latestSessionForProject(projectRoot);
        if (!session || session.mode !== 'debug' || !session.debug?.active || !session.gdb) {
            return empty('Start the operating system in Debug mode, then pause it after KMain to inspect the retained final UEFI memory map.');
        }
        if (!session.debug.paused) return empty('Pause the kernel to read its retained final UEFI memory map safely.', true, false);
        if (session.relocationDelta === undefined) return empty('The debugger has not resolved the relocated kernel image yet.', true, true);
        try {
            const linkedBootContext = await this.findLinkedNativeSymbol(session, 'InuBootContext');
            if (linkedBootContext === undefined) return empty('InuBootContext was not found in the linked kernel map. Rebuild the Debug kernel with symbols enabled.', true, true);
            const runtimeBootContext = linkedBootContext + session.relocationDelta;
            const header = await this.readMemoryChunked(session.gdb, runtimeBootContext, 0x98, 0x98);
            if (header.length !== 0x98 || header.readBigUInt64LE(0) !== 0x4E59524F41564F4En) {
                return empty(`The Inu boot-context ABI was not readable at ${this.formatAddress(runtimeBootContext)}.`, true, true);
            }
            const mapAddress = header.readBigUInt64LE(0x38);
            const mapLength = header.readBigUInt64LE(0x40);
            const mapKey = header.readBigUInt64LE(0x48);
            const descriptorSize64 = header.readBigUInt64LE(0x50);
            const descriptorVersion = header.readUInt32LE(0x58);
            const captureAttempts = header.readUInt32LE(0x5c);
            const exitStatus = header.readBigUInt64LE(0x60);
            const finalFlag = header.readBigUInt64LE(0x68);
            if (finalFlag !== 1n || exitStatus !== 0n) return empty(`The retained firmware map is not final (flag=${finalFlag}, ExitBootServices status=${exitStatus}).`, true, true);
            if (descriptorSize64 < 40n || descriptorSize64 > 4096n || (descriptorSize64 & 7n) !== 0n || mapLength === 0n || mapLength > 524288n || mapLength % descriptorSize64 !== 0n) {
                return empty('The retained UEFI memory-map metadata is invalid or outside the supported Inu boot-context limits.', true, true);
            }
            const descriptorSize = Number(descriptorSize64);
            const descriptorCount = Number(mapLength / descriptorSize64);
            const bytes = await this.readMemoryChunked(session.gdb, mapAddress, Number(mapLength), 1024);
            if (bytes.length !== Number(mapLength)) return empty(`Could not read the complete UEFI memory map at ${this.formatAddress(mapAddress)}.`, true, true);
            const regions: InuMemoryMapRegion[] = [];
            let total = 0n; let usable = 0n; let highest = 0n;
            const categoryBytes = new Map<InuMemoryRegionCategory, { count: number; bytes: bigint }>();
            for (let index = 0; index < descriptorCount; index++) {
                const offset = index * descriptorSize;
                const firmwareType = bytes.readUInt32LE(offset);
                const physicalStart = bytes.readBigUInt64LE(offset + 8);
                const virtualStart = bytes.readBigUInt64LE(offset + 16);
                const pages = bytes.readBigUInt64LE(offset + 24);
                const attributes = bytes.readBigUInt64LE(offset + 32);
                const byteCount = pages * 4096n;
                const physicalEnd = physicalStart + byteCount;
                const type = this.uefiMemoryType(firmwareType);
                total += byteCount; if (type.category === 'usable') usable += byteCount; if (physicalEnd > highest) highest = physicalEnd;
                const previous = categoryBytes.get(type.category) ?? { count: 0, bytes: 0n };
                previous.count++; previous.bytes += byteCount; categoryBytes.set(type.category, previous);
                regions.push({ index, firmwareType, typeName: type.name, category: type.category, physicalStart: this.formatAddress(physicalStart), physicalEnd: this.formatAddress(physicalEnd), virtualStart: this.formatAddress(virtualStart), pageCount: this.safeNumber(pages), byteCount: this.safeNumber(byteCount), attributes: `0x${attributes.toString(16).padStart(16, '0')}` });
            }
            const reservations = [] as InuMemoryMapSnapshot['reservations'];
            const addReservation = (name: string, address: bigint, byteCount: bigint, details?: string): void => {
                if (address !== 0n && byteCount !== 0n) reservations.push({ name, physicalStart: this.formatAddress(address), byteCount: this.safeNumber(byteCount), details });
            };
            addReservation('Framebuffer', header.readBigUInt64LE(0x08), header.readBigUInt64LE(0x10), 'UEFI GOP framebuffer');
            addReservation('Bootstrap page-table workspace', header.readBigUInt64LE(0x70), header.readBigUInt64LE(0x78) * 4096n, 'Reserved before ExitBootServices');
            addReservation('AP startup trampoline', header.readBigUInt64LE(0x88), header.readBigUInt64LE(0x90) * 4096n, 'SIPI trampoline below 1 MiB');
            const categories = [...categoryBytes.entries()].map(([category, value]) => ({ category, regionCount: value.count, byteCount: this.safeNumber(value.bytes) })).sort((a,b) => b.byteCount - a.byteCount);
            return {
                success: true, active: true, paused: true, capturedAtUtc, descriptorVersion, descriptorSize, descriptorCount,
                mapKey: `0x${mapKey.toString(16)}`, mapRuntimeAddress: this.formatAddress(mapAddress), captureAttempts,
                totalBytes: this.safeNumber(total), usableBytes: this.safeNumber(usable), highestPhysicalAddress: this.formatAddress(highest),
                regions, categories, reservations,
                message: `Read ${descriptorCount} descriptor(s) directly from the retained final UEFI memory map in the paused Inu kernel.`
            };
        } catch (error) {
            return empty('The memory map could not be read from the paused kernel.', true, true, error instanceof Error ? error.message : String(error));
        }
    }


    async inspectInterrupts(projectPath: string): Promise<InuInterruptSnapshot> {
        const capturedAtUtc = new Date().toISOString();
        const empty = (message: string, active = false, paused = false, error?: string): InuInterruptSnapshot => ({
            success: false, active, paused, capturedAtUtc, vectors: [], routes: [], ioApics: [], localApicRegisters: [], message, error
        });
        const projectRoot = path.resolve(projectPath);
        if (!this.isOperatingSystemPath(projectRoot)) return empty('Open a Inu operating system to inspect interrupt routing.');
        const session = this.latestSessionForProject(projectRoot);
        if (!session || session.mode !== 'debug' || !session.debug?.active || !session.gdb) return empty('Start the operating system in Debug mode, then pause it after interrupt initialization.');
        if (!session.debug.paused) return empty('Pause the kernel to read interrupt-controller state safely.', true, false);
        if (session.relocationDelta === undefined) return empty('The debugger has not resolved the relocated kernel image yet.', true, true);
        try {
            await this.ensureNativeGlobalSymbols(session);
            const runtime = (component: string, suffix: string): bigint | undefined => {
                const symbol = this.findKernelGlobal(session, component, suffix);
                return symbol ? symbol.linkedAddress + session.relocationDelta! : undefined;
            };
            const readU8 = async (component: string, suffix: string): Promise<number | undefined> => {
                const address = runtime(component, suffix); if (address === undefined) return undefined;
                const bytes = await this.readMemory(session.gdb!, address, 1); return bytes.length === 1 ? bytes[0] : undefined;
            };
            const readU32 = async (component: string, suffix: string): Promise<number | undefined> => {
                const address = runtime(component, suffix); if (address === undefined) return undefined;
                const bytes = await this.readMemory(session.gdb!, address, 4); return bytes.length === 4 ? bytes.readUInt32LE(0) : undefined;
            };
            const readU64 = async (component: string, suffix: string): Promise<bigint | undefined> => {
                const address = runtime(component, suffix); if (address === undefined) return undefined;
                const bytes = await this.readMemory(session.gdb!, address, 8); return bytes.length === 8 ? bytes.readBigUInt64LE(0) : undefined;
            };
            const dispatchInitialized = (await readU8('KernelInterruptDispatch', '_initialized')) === 1;
            const brokerInitialized = (await readU8('KernelInterruptBroker', '_initialized')) === 1;
            const localApic = (await readU8('KernelInterruptBroker', '_localApic')) === 1;
            const ioApic = (await readU8('KernelInterruptBroker', '_ioApic')) === 1;
            const x2Apic = (await readU8('KernelInterruptBroker', '_x2Apic')) === 1;
            const localApicBase = await readU64('KernelInterruptDispatch', '_localApicBase');
            const routeCount = await readU32('KernelInterruptBroker', '_count') ?? 0;
            const routeCapacity = await readU32('KernelInterruptBroker', '_capacity') ?? 0;
            const ioApicCount = await readU32('KernelInterruptBroker', '_ioApicCount') ?? 0;
            const allocatedPointer = await readU64('KernelInterruptDispatch', '_allocated');
            const callbacksPointer = await readU64('KernelInterruptDispatch', '_callbacks');
            const cookiesPointer = await readU64('KernelInterruptDispatch', '_cookies');
            const allocated = allocatedPointer ? await this.readMemoryChunked(session.gdb, allocatedPointer, 256, 256) : Buffer.alloc(0);
            const callbacks = callbacksPointer ? await this.readMemoryChunked(session.gdb, callbacksPointer, 2048, 512) : Buffer.alloc(0);
            const cookies = cookiesPointer ? await this.readMemoryChunked(session.gdb, cookiesPointer, 2048, 512) : Buffer.alloc(0);
            const exceptionNames = ['Divide by zero','Debug','NMI','Breakpoint','Overflow','Bound range','Invalid opcode','Device not available','Double fault','Coprocessor segment overrun','Invalid TSS','Segment not present','Stack fault','General protection','Page fault','Reserved','x87 floating point','Alignment check','Machine check','SIMD floating point','Virtualisation','Control protection','Reserved','Reserved','Reserved','Reserved','Reserved','Reserved','Hypervisor injection','VMM communication','Security','Reserved'];
            const breakVectors = new Set(session.exceptionBreakpoints.vectors ?? []);
            const vectors: InuInterruptVectorInfo[] = [];
            let allocatedDynamicVectors = 0;
            for (let vector=0; vector<256; vector++) {
                const dynamic = vector >= 0x40 && vector <= 0xEF;
                const isAllocated = allocated.length === 256 ? allocated[vector] !== 0 : false;
                if (dynamic && isAllocated) allocatedDynamicVectors++;
                let callback: string | undefined; let cookie: string | undefined;
                if (callbacks.length === 2048) { const value=callbacks.readBigUInt64LE(vector*8); if (value) callback=this.formatAddress(value); }
                if (cookies.length === 2048) { const value=cookies.readBigUInt64LE(vector*8); if (value) cookie=`0x${value.toString(16)}`; }
                if (vector < 32 || isAllocated || callback) vectors.push({ vector, hex:`0x${vector.toString(16).padStart(2,'0')}`, kind:vector<32?'exception':dynamic?'dynamic':'system', allocated:isAllocated, callback, cookie, exceptionName:vector<32?exceptionNames[vector]:undefined, breakOnException:vector<32?breakVectors.has(vector):undefined });
            }
            const mechanism = (value: number): InuInterruptMechanism => { switch (value) { case 1:return 'io-apic'; case 2:return 'msi'; case 3:return 'msi-x'; case 4:return 'local-apic'; case 5:return 'x2apic'; default:return 'none'; } };
            const routes: InuInterruptSnapshot['routes'] = [];
            const routesPointer = await readU64('KernelInterruptBroker', '_routes');
            if (routesPointer && routeCapacity > 0 && routeCapacity <= 4096) {
                const raw = await this.readMemoryChunked(session.gdb, routesPointer, routeCapacity*48, 768);
                for (let i=0;i<routeCapacity && i*48+48<=raw.length;i++) {
                    const o=i*48; if (raw[o]===0) continue;
                    const segment=raw.readUInt16LE(o+40), bus=raw[o+42], dev=raw[o+43], fn=raw[o+44];
                    routes.push({ handle:`0x${raw.readBigUInt64LE(o+16).toString(16)}`, vector:raw[o+1], mechanism:mechanism(raw[o+2]), device:raw.readUInt32LE(o+4), source:raw.readUInt32LE(o+8), targetProcessor:raw.readUInt32LE(o+12), direct:raw[o+3]!==0, pci:(segment||bus||dev||fn)?`${segment.toString(16).padStart(4,'0')}:${bus.toString(16).padStart(2,'0')}:${dev.toString(16).padStart(2,'0')}.${fn}`:undefined, cookie:`0x${raw.readBigUInt64LE(o+24).toString(16)}` });
                }
            }
            const ioApics: InuInterruptSnapshot['ioApics'] = [];
            const ioApicsPointer = await readU64('KernelInterruptBroker', '_ioApics');
            if (ioApicsPointer && ioApicCount <= 256) {
                const raw = await this.readMemoryChunked(session.gdb, ioApicsPointer, ioApicCount*16, 512);
                for (let i=0;i<ioApicCount && i*16+16<=raw.length;i++) { const o=i*16, base=raw.readUInt32LE(o+8), max=raw.readUInt32LE(o+12); ioApics.push({index:i,mappedAddress:this.formatAddress(raw.readBigUInt64LE(o)),baseGsi:base,maximumGsi:max,pinCount:max>=base?max-base+1:0}); }
            }
            const localApicRegisters: InuInterruptSnapshot['localApicRegisters'] = [];
            if (localApic && !x2Apic && localApicBase) {
                for (const [name,off] of [['APIC ID',0x20],['Version',0x30],['Task Priority',0x80],['Processor Priority',0xA0],['Spurious Vector',0xF0],['LVT Timer',0x320],['LVT LINT0',0x350],['LVT LINT1',0x360],['LVT Error',0x370],['Timer Current',0x390],['Timer Divide',0x3E0]] as Array<[string,number]>) {
                    let value: string | undefined; try { const b=await this.readMemory(session.gdb,localApicBase+BigInt(off),4); if(b.length===4)value=`0x${b.readUInt32LE(0).toString(16).padStart(8,'0')}`; } catch { }
                    localApicRegisters.push({name,offset:`0x${off.toString(16)}`,value});
                }
            }
            return { success:true, active:true, paused:true, capturedAtUtc, dispatchInitialized, brokerInitialized, localApic, ioApic, x2Apic, msi:brokerInitialized, msiX:brokerInitialized, localApicBase:localApicBase?this.formatAddress(localApicBase):undefined, routeCount, routeCapacity, ioApicCount, allocatedDynamicVectors, vectors, routes, ioApics, localApicRegisters, message:`Read Inu interrupt dispatch and broker state from paused kernel memory (${routes.length} active route(s), ${allocatedDynamicVectors} allocated dynamic vector(s)).` };
        } catch (error) { return empty('Interrupt/APIC state could not be read from the paused kernel.', true, true, error instanceof Error ? error.message : String(error)); }
    }

    async inspectSyscalls(projectPath: string): Promise<InuSyscallSnapshot> {
        const root = path.resolve(projectPath);
        const capturedAtUtc = new Date().toISOString();
        const configurationResult = await this.readProjectConfiguration(root);
        const configuredModel = configurationResult.success ? configurationResult.configuration?.syscallModel : undefined;
        const counts = (): Record<InuSyscallAbi, number> => ({ 'inu-get':0, 'inu-set':0, 'inu-event':0, linux:0, 'windows-nt':0 });
        const builtins = (): InuSyscallEntry[] => [
            { abi:'inu-get', number:0, encoded:'0x1000000000000000', name:'ABI version', source:'builtin', registered:true, description:'Returns the Inu native syscall ABI version.' },
            { abi:'inu-get', number:1, encoded:'0x1000000000000001', name:'Monotonic time', source:'builtin', registered:true, description:'Returns monotonic nanoseconds.' },
            { abi:'inu-get', number:2, encoded:'0x1000000000000002', name:'Online processor count', source:'builtin', registered:true },
            { abi:'inu-set', number:0, encoded:'0x1100000000000000', name:'Scheduler quantum', source:'builtin', registered:true, description:'Sets the scheduler quantum in nanoseconds.' },
            { abi:'inu-event', number:0, encoded:'0x1200000000000000', name:'Yield', source:'builtin', registered:true, description:'Yields the current processor scheduler context.' },
            { abi:'linux', number:24, name:'sched_yield', source:'builtin', registered:true, description:'Linux-style scheduler yield compatibility syscall.' }
        ];
        const session = this.latestSessionForProject(root);
        if (!session || session.mode !== 'debug' || !session.gdb || !session.debug?.active) {
            return { success:true, active:false, paused:false, capturedAtUtc, configuredModel, registrySlots:64, entries:builtins(), registeredCounts:counts(), message:'Showing configured and built-in syscall contracts. Start Debug and pause the kernel to inspect live registered handlers.' };
        }
        if (!session.debug.paused) {
            return { success:true, active:true, paused:false, capturedAtUtc, configuredModel, registrySlots:64, entries:builtins(), registeredCounts:counts(), message:'Kernel is running. Pause it to read the live syscall registry.' };
        }
        try {
            await this.ensureNativeGlobalSymbols(session);
            if (session.relocationDelta === undefined) throw new Error('Kernel relocation delta is unavailable.');
            const addressOf = (suffix: string): bigint | undefined => {
                const symbol = this.findKernelGlobal(session, 'KernelSystemCalls', suffix);
                return symbol ? symbol.linkedAddress + session.relocationDelta! : undefined;
            };
            const readByte = async (suffix:string):Promise<number|undefined> => { const a=addressOf(suffix); if(a===undefined)return undefined; const b=await this.readMemory(session.gdb!,a,1); return b.length===1?b[0]:undefined; };
            const readU32 = async (suffix:string):Promise<number|undefined> => { const a=addressOf(suffix); if(a===undefined)return undefined; const b=await this.readMemory(session.gdb!,a,4); return b.length===4?b.readUInt32LE(0):undefined; };
            const readU64 = async (suffix:string):Promise<bigint|undefined> => { const a=addressOf(suffix); if(a===undefined)return undefined; return this.readU64(session.gdb!,a); };
            const initialized=(await readByte('_initialized'))===1;
            const smapEnabled=(await readByte('_smapEnabled'))===1;
            const configuredProcessors=await readU32('_configuredProcessors');
            const stackBase=await readU64('_stackBase'), stackTop=await readU64('_stackTop');
            const registryAddress=addressOf('_registry');
            const entries=builtins(); const registeredCounts=counts();
            const abiAtIndex: InuSyscallAbi[]=['inu-get','inu-set','inu-event','linux','windows-nt'];
            if (registryAddress !== undefined) {
                const raw=await this.readMemoryChunked(session.gdb,registryAddress,64*8*5,1024);
                if(raw.length===64*8*5) {
                    for(let table=0;table<5;table++) for(let number=0;number<64;number++) {
                        const handler=raw.readBigUInt64LE((table*64+number)*8); if(handler===0n) continue;
                        const abi=abiAtIndex[table]; registeredCounts[abi]++;
                        const linked=session.relocationDelta!==undefined?handler-session.relocationDelta:undefined;
                        const source=linked!==undefined&&session.nativeDebugMap?this.resolveSourceLocation(session.nativeDebugMap,linked):undefined;
                        const encoded=abi==='inu-get'?`0x${(0x1000000000000000n+BigInt(number)).toString(16)}`:abi==='inu-set'?`0x${(0x1100000000000000n+BigInt(number)).toString(16)}`:abi==='inu-event'?`0x${(0x1200000000000000n+BigInt(number)).toString(16)}`:undefined;
                        entries.push({abi,number,encoded,name:`Registered ${abi} ${number}`,source:'registered',registered:true,handlerAddress:this.formatAddress(handler),sourcePath:source?.sourcePath,line:source?.line});
                    }
                }
            }
            entries.sort((a,b)=>abiAtIndex.indexOf(a.abi)-abiAtIndex.indexOf(b.abi)||a.number-b.number||a.source.localeCompare(b.source));
            return { success:true,active:true,paused:true,capturedAtUtc,configuredModel,initialized,smapEnabled,configuredProcessors,syscallStackBase:stackBase?this.formatAddress(stackBase):undefined,syscallStackTop:stackTop?this.formatAddress(stackTop):undefined,syscallStackBytes:stackBase&&stackTop&&stackTop>=stackBase?this.safeNumber(stackTop-stackBase):32768,registrySlots:64,entries,registeredCounts,message:`Read KernelSystemCalls and ${Object.values(registeredCounts).reduce((a,b)=>a+b,0)} registered handler(s) from paused kernel memory.` };
        } catch(error) {
            return { success:false,active:true,paused:true,capturedAtUtc,configuredModel,registrySlots:64,entries:builtins(),registeredCounts:counts(),error:error instanceof Error?error.message:String(error),message:'Live syscall registry could not be read.' };
        }
    }

    protected uefiMemoryType(type: number): { name: string; category: InuMemoryRegionCategory } {
        switch (type) {
            case 0: return { name: 'Reserved', category: 'reserved' };
            case 1: return { name: 'Loader Code', category: 'boot-reclaimable' };
            case 2: return { name: 'Loader Data', category: 'boot-reclaimable' };
            case 3: return { name: 'Boot Services Code', category: 'boot-reclaimable' };
            case 4: return { name: 'Boot Services Data', category: 'boot-reclaimable' };
            case 5: return { name: 'Runtime Services Code', category: 'runtime' };
            case 6: return { name: 'Runtime Services Data', category: 'runtime' };
            case 7: return { name: 'Conventional Memory', category: 'usable' };
            case 8: return { name: 'Unusable Memory', category: 'unusable' };
            case 9: return { name: 'ACPI Reclaim Memory', category: 'acpi-reclaimable' };
            case 10: return { name: 'ACPI NVS Memory', category: 'acpi-nvs' };
            case 11: return { name: 'Memory-mapped I/O', category: 'mmio' };
            case 12: return { name: 'Memory-mapped I/O Port Space', category: 'mmio' };
            case 13: return { name: 'PAL Code', category: 'reserved' };
            case 14: return { name: 'Persistent Memory', category: 'persistent' };
            case 15: return { name: 'Unaccepted Memory', category: 'unaccepted' };
            default: return { name: `Firmware Type ${type}`, category: 'unknown' };
        }
    }

    protected async findLinkedNativeSymbol(session: RunSession, symbolName: string): Promise<bigint | undefined> {
        const image = session.nativeDebugMap?.image ?? path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel', 'MinimalKernel.bin');
        const nm = path.join(INU_SDK_ROOT, '.toolchain', 'LLVM', 'bin', 'llvm-nm.exe');
        if (await this.exists(nm) && await this.exists(image)) {
            const output = await this.captureTool(nm, ['--numeric-sort', image]);
            if (output.exitCode === 0) {
                for (const line of output.text.split(/\r?\n/)) {
                    const match = /^\s*([0-9a-fA-F]+)\s+[A-Za-z?]\s+(.+?)\s*$/.exec(line);
                    if (match && match[2] === symbolName) return BigInt(`0x${match[1]}`);
                }
            }
        }
        try {
            const mapText = await fs.readFile(session.nativeDebugMap?.map ?? '', 'utf8');
            for (const line of mapText.split(/\r?\n/)) {
                if (!line.includes(symbolName)) continue;
                const values = Array.from(line.matchAll(/(?:0x)?([0-9a-fA-F]{8,16})/g)).map(match => BigInt(`0x${match[1]}`));
                const linkedAddress = values.find(value => value >= 0x01000000n);
                if (linkedAddress !== undefined) return linkedAddress;
            }
        } catch { }
        return undefined;
    }

    async listTargets(projectPath: string): Promise<InuTargetState> {
        const root = path.resolve(projectPath);
        if (!this.isOperatingSystemPath(root)) return this.defaultTargetState();
        return this.readTargetState(root);
    }

    async getActiveTarget(projectPath: string): Promise<InuTargetProfile | undefined> {
        const state = await this.listTargets(projectPath);
        return state.targets.find(item => item.id === state.activeTargetId);
    }

    async probePhysicalDebugger(projectPath: string, targetId?: string): Promise<InuPhysicalDebuggerProbe> {
        try {
            const state = await this.listTargets(projectPath);
            const target = targetId ? state.targets.find(item => item.id === targetId) : state.targets.find(item => item.id === state.activeTargetId);
            if (!target) return { success: false, connected: false, error: 'Inu target was not found.' };
            if (target.kind !== 'physical' || !target.physical) return { success: false, connected: false, targetId: target.id, targetName: target.name, error: 'Select a Physical machine target first.' };
            const { gdbHost: host, gdbPort: port, serialPort, baudRate } = target.physical;
            const gdb = new GdbRspClient(() => undefined);
            await gdb.connect(host, port, 3000);
            let stopReply: string | undefined;
            try { stopReply = await gdb.command('?'); } catch { stopReply = undefined; }
            gdb.close();
            return { success: true, connected: true, targetId: target.id, targetName: target.name, host, port, serialPort, baudRate, stopReply, message: `GDB Remote Serial Protocol endpoint ${host}:${port} accepted a connection${stopReply ? ` (stop reply ${stopReply})` : ''}.` };
        } catch (error) {
            return { success: false, connected: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async saveTarget(projectPath: string, target: InuTargetProfile): Promise<InuTargetMutationResult> {
        try {
            const root = path.resolve(projectPath);
            if (!this.isOperatingSystemPath(root)) return { success: false, error: 'Targets can only be saved for a Inu OS workspace.' };
            const configurationResult = await this.readProjectConfiguration(root);
            if (!configurationResult.success || !configurationResult.configuration) return { success: false, error: configurationResult.error ?? 'Could not read Inu configuration.' };
            if (target.kind === 'qemu' && target.qemu) target = { ...target, qemu: { ...target.qemu, cpuCount: configurationResult.configuration.qemuCpuCount } };
            const invalid = this.validateTarget(target); if (invalid) return { success: false, error: invalid };
            const state = await this.readTargetState(root);
            const index = state.targets.findIndex(item => item.id === target.id);
            if (index >= 0) state.targets[index] = target; else state.targets.push(target);
            if (!state.activeTargetId) state.activeTargetId = target.id;
            await fs.writeFile(this.targetFile(root), JSON.stringify(state, null, 2) + '\n', 'utf8');
            return { success: true, state };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    }

    async deleteTarget(projectPath: string, targetId: string): Promise<InuTargetMutationResult> {
        try {
            const root = path.resolve(projectPath); const state = await this.readTargetState(root);
            if (state.targets.length <= 1) return { success: false, state, error: 'A Inu OS must retain at least one target.' };
            state.targets = state.targets.filter(item => item.id !== targetId);
            if (state.targets.length === 0) return { success: false, error: 'A Inu OS must retain at least one target.' };
            if (!state.targets.some(item => item.id === state.activeTargetId)) state.activeTargetId = state.targets[0].id;
            await fs.writeFile(this.targetFile(root), JSON.stringify(state, null, 2) + '\n', 'utf8');
            return { success: true, state };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    }

    async setActiveTarget(projectPath: string, targetId: string): Promise<InuTargetMutationResult> {
        try {
            const root = path.resolve(projectPath); const state = await this.readTargetState(root);
            if (!state.targets.some(item => item.id === targetId)) return { success: false, state, error: `Target ${targetId} was not found.` };
            state.activeTargetId = targetId;
            await fs.writeFile(this.targetFile(root), JSON.stringify(state, null, 2) + '\n', 'utf8');
            return { success: true, state };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    }

    protected isOperatingSystemPath(projectRoot: string): boolean {
        const resolved = path.resolve(projectRoot);
        if (resolved === path.parse(resolved).root) return false;
        try { return require('fs').existsSync(path.join(resolved, 'Inu.json')); } catch { return false; }
    }

    protected async readSdkContractVersions(): Promise<{ sdkVersion: string; apiVersion: string; driverAbiVersion: string }> {
        try {
            const raw = JSON.parse(await fs.readFile(path.join(INU_SDK_ROOT, 'Inu.SdkManifest.json'), 'utf8')) as { sdkVersion?: string; apiVersion?: string; abi?: { driver?: string } };
            return { sdkVersion: raw.sdkVersion || '0.44.18', apiVersion: raw.apiVersion || '1.0', driverAbiVersion: raw.abi?.driver || '1.0' };
        } catch { return { sdkVersion: 'unknown', apiVersion: '1.0', driverAbiVersion: '1.0' }; }
    }

    protected normaliseHexId(value?: string): string | undefined {
        const cleaned = (value ?? '').trim().replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '').slice(0, 4);
        return cleaned ? `0x${cleaned.toUpperCase().padStart(4, '0')}` : undefined;
    }

    protected driverProjectFile(name: string): string {
        return `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <ImplicitUsings>disable</ImplicitUsings>\n    <Nullable>enable</Nullable>\n    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>\n    <AssemblyName>Inu.Driver.${name}</AssemblyName>\n  </PropertyGroup>\n  <ItemGroup>\n    <ProjectReference Include="..\\..\\Sdk\\Inu.Kernel.Drivers\\Inu.Kernel.Drivers.csproj" />\n  </ItemGroup>\n</Project>\n`;
    }

    protected driverSource(name: string, manifest: InuDriverManifest): string {
        const ns = `Inu.Driver.${this.namespace(name)}`;
        const match = manifest.kind === 'pci'
            ? `// PCI match: vendor ${manifest.vendorId ?? 'any'}, device ${manifest.deviceId ?? 'any'}`
            : manifest.kind === 'usb' ? `// USB match: VID ${manifest.usbVendorId ?? 'any'}, PID ${manifest.usbProductId ?? 'any'}`
            : manifest.kind === 'virtio' ? `// VirtIO device id: ${manifest.virtioDeviceId ?? 0}` : '// Platform-device driver';
        const capabilityNames: Record<InuDriverCapability, string> = { 'mmio':'Mmio','pio':'PortIo','interrupts':'Interrupt','msi':'Msi','msix':'MsiX','dma':'Dma','pci-config':'PciConfig','physical-memory':'PhysicalMemory','timers':'Timers','networking':'Networking','filesystem':'Filesystem' };
        const capabilityExpression = manifest.capabilities.length ? manifest.capabilities.map(cap => `KernelDriverCapability.${capabilityNames[cap]}`).join(' | ') : 'KernelDriverCapability.None';
        return `using System;\nusing Inu.Kernel.Drivers;\n\nnamespace ${ns};\n\n/// <summary>${manifest.description || `${name} Inu device driver.`}</summary>\npublic static unsafe class ${this.namespace(name)}Driver\n{\n    ${match}\n    public const string DriverAbiVersion = ${JSON.stringify(manifest.driverAbiVersion)};\n\n    /// <summary>Registers this driver and its maximum allowed privilege declaration.</summary>\n    public static Boolean Initialize()\n    {\n        // TODO: replace the generic match rule with the device identifiers from Inu.Driver.json.\n        KernelDriverMatchRule rule = new(KernelDeviceBus.Synthetic, false, 0, false, 0, false, 0U, 0U);\n        KernelDriverCallbacks callbacks = new(&Discover, &Probe, &Bind, &Start, &Stop, &Reset, &Suspend, &Resume, &Remove, &Fail, &Recover, &Interrupt);\n        KernelDriverCapabilityDeclaration declaration = new(${capabilityExpression});\n        return KernelDrivers.RegisterDriver(rule, callbacks, declaration, out _);\n    }\n\n    private static Boolean Discover(KernelDriverDeviceContext* context) => context != null;\n    private static Boolean Probe(KernelDriverDeviceContext* context) => context != null;\n    private static Boolean Bind(KernelDriverDeviceContext* context) => context != null;\n    private static Boolean Start(KernelDriverDeviceContext* context) => context != null;\n    private static Boolean Stop(KernelDriverDeviceContext* context) => context != null;\n    private static Boolean Reset(KernelDriverDeviceContext* context) => context != null;\n    private static Boolean Suspend(KernelDriverDeviceContext* context) => context != null;\n    private static Boolean Resume(KernelDriverDeviceContext* context) => context != null;\n    private static Boolean Remove(KernelDriverDeviceContext* context) => context != null;\n    private static Boolean Fail(KernelDriverDeviceContext* context, KernelDriverFailureCode failure) => context != null;\n    private static Boolean Recover(KernelDriverDeviceContext* context) => context != null;\n    private static Boolean Interrupt(KernelDriverDeviceContext* context, UInt64 cookie) => context != null;\n}\n`;
    }

    protected driverReadme(manifest: InuDriverManifest): string {
        return `# ${manifest.name}\n\nInu ${manifest.kind} driver project generated by Kath ${KATH_VERSION}.\n\n- Package ID: ${manifest.id}\n- Architecture: ${manifest.architecture || 'any'}\n- Minimum Inu: ${manifest.minimumInuVersion || 'unspecified'}\n- SDK API: ${manifest.sdkApiVersion}\n- Driver ABI: ${manifest.driverAbiVersion}\n- Capabilities: ${manifest.capabilities.join(', ') || 'none declared'}\n\nEdit \`Inu.Driver.json\` when changing device identifiers or capabilities. Keep the declared ABI compatible with the SDK manifest.\n`;
    }

    protected driverTestProjectFile(name: string, driverProjectRelative: string): string {
        return `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <OutputType>Exe</OutputType>\n    <ImplicitUsings>disable</ImplicitUsings>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n  <ItemGroup><ProjectReference Include="${driverProjectRelative}" /></ItemGroup>\n</Project>\n`;
    }

    protected driverTestSource(name: string): string {
        return `using System;\n\nConsole.WriteLine("Inu driver contract test: ${name}");\nConsole.WriteLine("[ OK ] Driver project and manifest are loadable.");\nreturn 0;\n`;
    }

    async listTests(projectPath: string): Promise<InuTestDescriptor[]> {
        const projectRoot = path.resolve(projectPath);
        const tests: InuTestDescriptor[] = [];
        const scan = async (root: string, source: 'os' | 'sdk'): Promise<void> => {
            try {
                const entries = await fs.readdir(root, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const folder = path.join(root, entry.name);
                    const children = await fs.readdir(folder).catch(() => [] as string[]);
                    const csproj = children.find(name => name.toLowerCase().endsWith('.csproj'));
                    if (!csproj) continue;
                    const projectFile = path.join(folder, csproj);
                    const name = path.basename(csproj, '.csproj');
                    const category = name.replace(/^Inu\./i, '').replace(/\.Tests$/i, '').replace(/[._-]+/g, ' ');
                    tests.push({ id: `${source}:${projectFile.toLowerCase()}`, name, projectPath: projectFile, source, category });
                }
            } catch { }
        };
        await scan(path.join(projectRoot, 'Tests'), 'os');
        await scan(path.join(projectRoot, 'tests'), 'os');
        await scan(path.join(INU_SDK_ROOT, 'tests'), 'sdk');
        const unique = new Map<string, InuTestDescriptor>();
        for (const test of tests) unique.set(test.projectPath.toLowerCase(), test);
        return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    async runTest(projectPath: string, testId: string): Promise<InuTestRunResult> {
        try {
            const tests = await this.listTests(projectPath);
            const test = tests.find(item => item.id === testId);
            if (!test) return { success: false, error: 'The selected Inu test was not found.' };
            const dotnet = path.join(INU_SDK_ROOT, '.toolchain', 'DotNet', 'dotnet.exe');
            await fs.access(dotnet);
            const runId = `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            const run = { output: `[INFO] Inu Test Explorer\r\n[INFO] ${test.name}\r\n[INFO] Project: ${test.projectPath}\r\n\r\n`, complete: false } as { output: string; complete: boolean; exitCode?: number; error?: string };
            this.testRuns.set(runId, run);
            const child = spawn(dotnet, ['run', '--project', test.projectPath, '--configuration', 'Debug', '--nologo'], {
                cwd: path.dirname(test.projectPath), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
            });
            child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
            child.stdout?.on('data', data => { run.output += data; });
            child.stderr?.on('data', data => { run.output += data; });
            child.on('error', error => { run.error = error.message; run.output += `\r\n[FAIL] ${error.message}\r\n`; run.exitCode = 1; run.complete = true; });
            child.on('close', code => { run.exitCode = code ?? 1; run.output += code === 0 ? '\r\n[ OK ] Test passed.\r\n' : `\r\n[FAIL] Test exited with code ${code ?? -1}.\r\n`; run.complete = true; });
            return { success: true, runId };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    }

    async readTestOutput(runId: string, offset: number): Promise<InuTestOutput> {
        const run = this.testRuns.get(runId);
        if (!run) return { text: '', nextOffset: offset, complete: true, exitCode: 1, error: 'Unknown Inu test run.' };
        const safeOffset = Math.max(0, Math.min(offset, run.output.length));
        const text = run.output.slice(safeOffset);
        if (run.complete) this.testRuns.delete(runId);
        return { text, nextOffset: run.output.length, complete: run.complete, exitCode: run.exitCode, error: run.error };
    }

    async getHardwareMatrixPlan(projectPath: string, preset: InuHardwareMatrixPreset): Promise<InuHardwareMatrixPlan> {
        try {
            const projectRoot = this.requireOperatingSystemRoot(projectPath);
            await fs.access(projectRoot);
            const configurationResult = await this.readProjectConfiguration(projectRoot);
            if (!configurationResult.success || !configurationResult.configuration) {
                return { success: false, preset, cases: [], coverage: [], biosSupported: false, debugOnly: true, error: configurationResult.error ?? 'Could not read Inu.json for hardware validation.' };
            }
            const artifactRoot = path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel');
            const biosSupported = await this.exists(path.join(artifactRoot, 'MinimalKernel-bios.img'));
            const planned = this.createHardwareMatrixCases(configurationResult.configuration, preset, biosSupported);
            const emulated = planned.coverage.filter(item => item.status === 'emulated' || item.status === 'implicit').length;
            const unavailable = planned.coverage.filter(item => item.status === 'not-emulated').length;
            return {
                success: true,
                preset,
                cases: planned.cases,
                coverage: planned.coverage,
                biosSupported,
                debugOnly: true,
                message: `Debug-only validation is derived from Inu.json: ${emulated} selected driver/device path(s) can be exercised by Kath${unavailable ? `; ${unavailable} selected path(s) require physical or future emulator coverage` : ''}.`
            };
        } catch (error) {
            return { success: false, preset, cases: [], coverage: [], biosSupported: false, debugOnly: true, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async runHardwareMatrix(projectPath: string, preset: InuHardwareMatrixPreset, mode: InuRunMode): Promise<InuHardwareMatrixRunResult> {
        try {
            if (mode !== 'debug') {
                return { success: false, error: 'Kath hardware/driver validation is Debug-only. Select Debug in the Run toolbar before starting validation.' };
            }
            const projectRoot = this.requireOperatingSystemRoot(projectPath);
            const plan = await this.getHardwareMatrixPlan(projectRoot, preset);
            if (!plan.success) return { success: false, error: plan.error ?? 'Could not prepare the QEMU hardware validation matrix.' };
            const runId = `matrix-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            const run = {
                output: `[INFO] Inu Debug Hardware Validation ${KATH_VERSION}\r\n[INFO] Mode: Debug (required)\r\n[INFO] Preset: ${preset === 'full' ? 'Validate All / expanded combinations' : 'Selected-driver validation'}\r\n[INFO] Project: ${projectRoot}\r\n[INFO] Planned cases: ${plan.cases.length}\r\n${plan.message ? `[INFO] ${plan.message}\r\n` : ''}${plan.coverage.map(item => `[${item.status === 'not-emulated' ? 'WARN' : 'INFO'}] ${item.driverId}: ${item.message}`).join('\r\n')}\r\n\r\n`,
                complete: false,
                cases: plan.cases.map(item => ({ ...item, drivers: [...item.drivers] })),
                coverage: plan.coverage.map(item => ({ ...item, caseIds: [...item.caseIds] }))
            } as { output: string; complete: boolean; exitCode?: number; error?: string; cases: InuHardwareMatrixCase[]; coverage: InuHardwareValidationCoverage[] };
            this.hardwareMatrixRuns.set(runId, run);
            void this.executeHardwareMatrix(projectRoot, run).catch(error => {
                run.error = error instanceof Error ? error.message : String(error);
                run.output += `\r\n[FAIL] Hardware validation aborted: ${run.error}\r\n`;
                run.exitCode = 1;
                run.complete = true;
            });
            return { success: true, runId };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    }

    async readHardwareMatrixOutput(runId: string, offset: number): Promise<InuHardwareMatrixOutput> {
        const run = this.hardwareMatrixRuns.get(runId);
        if (!run) return { text: '', nextOffset: offset, complete: true, exitCode: 1, cases: [], passed: 0, failed: 0, skipped: 0, error: 'Unknown Inu hardware-validation run.' };
        const safeOffset = Math.max(0, Math.min(offset, run.output.length));
        const text = run.output.slice(safeOffset);
        const passed = run.cases.filter(item => item.status === 'passed').length;
        const failed = run.cases.filter(item => item.status === 'failed').length;
        const skipped = run.cases.filter(item => item.status === 'skipped').length;
        return { text, nextOffset: run.output.length, complete: run.complete, exitCode: run.exitCode, cases: run.cases.map(item => ({ ...item, drivers: [...item.drivers] })), passed, failed, skipped, error: run.error };
    }

    protected createHardwareMatrixCases(configuration: InuProjectConfiguration, preset: InuHardwareMatrixPreset, biosSupported: boolean): { cases: InuHardwareMatrixCase[]; coverage: InuHardwareValidationCoverage[] } {
        type Spec = Omit<InuHardwareMatrixCase, 'id' | 'label' | 'status'>;
        const supportedStorage = configuration.storageControllers.filter((item): item is 'virtio-block' | 'ahci' | 'nvme' => item === 'virtio-block' || item === 'ahci' || item === 'nvme');
        const supportedNetwork = configuration.networkDrivers.filter((item): item is 'virtio-net' | 'e1000' => item === 'virtio-net' || item === 'e1000');
        const baselineStorage: InuHardwareMatrixCase['storage'] = supportedStorage[0] === 'ahci' ? 'ahci' : supportedStorage[0] === 'nvme' ? 'nvme' : 'virtio-blk';
        const configuredCpuCount = Math.max(1, Math.min(256, configuration.qemuCpuCount || 1));
        const wantsVirtioGpu = configuration.graphics.includes('virtio-gpu');
        const wantsXhci = configuration.drivers.includes('usb-xhci') || configuration.input.some(item => item.startsWith('usb-hid-'));
        const wantsVirtioConsole = configuration.drivers.includes('virtio-console');
        const platformDrivers: string[] = configuration.drivers.filter(item => item === 'pci' || item === 'acpi' || item === 'serial-16550');
        if (wantsVirtioConsole) platformDrivers.push('virtio-console');
        const inputDrivers: string[] = configuration.input.filter(item => item === 'ps2-keyboard' || item === 'ps2-mouse');
        const specs = new Map<string, Spec>();
        const addSpec = (candidate: Omit<Spec, 'drivers'>, drivers: string[]) => {
            const key = [candidate.cpuCount, candidate.memoryMiB, candidate.storage, candidate.network, candidate.graphics, candidate.usb, candidate.firmware].join('|');
            const existing = specs.get(key);
            if (existing) {
                existing.drivers = Array.from(new Set([...existing.drivers, ...drivers]));
                return;
            }
            specs.set(key, { ...candidate, drivers: Array.from(new Set(drivers)) });
        };
        const base = { cpuCount: configuredCpuCount, memoryMiB: 512, storage: baselineStorage, network: 'none' as const, graphics: 'gop' as const, usb: 'none' as const, firmware: 'uefi' as const };
        const baseDrivers = [...platformDrivers, ...inputDrivers];
        const selectedBaselineStorage = supportedStorage.find(item => (item === 'virtio-block' && baselineStorage === 'virtio-blk') || item === baselineStorage);
        if (selectedBaselineStorage) baseDrivers.push(selectedBaselineStorage);
        addSpec(base, baseDrivers);

        for (const storage of supportedStorage) {
            const matrixStorage = storage === 'virtio-block' ? 'virtio-blk' : storage;
            addSpec({ ...base, storage: matrixStorage }, [...platformDrivers, ...inputDrivers, storage]);
        }
        for (const network of supportedNetwork) addSpec({ ...base, network }, [...platformDrivers, ...inputDrivers, network]);
        if (wantsVirtioGpu) addSpec({ ...base, graphics: 'virtio-gpu' }, [...platformDrivers, ...inputDrivers, 'virtio-gpu']);
        if (wantsXhci) {
            const usbDrivers = ['usb-xhci', ...configuration.input.filter(item => item.startsWith('usb-hid-'))];
            addSpec({ ...base, usb: 'xhci' }, [...platformDrivers, ...usbDrivers]);
        }
        if (wantsVirtioConsole) addSpec(base, [...baseDrivers, 'virtio-console']);

        const selectedNetwork = supportedNetwork[0] ?? 'none';
        const combinedDrivers = [
            ...platformDrivers,
            ...inputDrivers,
            ...supportedStorage,
            ...supportedNetwork,
            ...(wantsVirtioGpu ? ['virtio-gpu'] : []),
            ...(wantsXhci ? ['usb-xhci', ...configuration.input.filter(item => item.startsWith('usb-hid-'))] : [])
        ];
        addSpec({ ...base, network: selectedNetwork, graphics: wantsVirtioGpu ? 'virtio-gpu' : 'gop', usb: wantsXhci ? 'xhci' : 'none' }, combinedDrivers);

        if (preset === 'full') {
            const cpuCounts = Array.from(new Set([1, configuredCpuCount, 4])).filter(value => value <= 256);
            const memories = [512, 1024];
            const storages: InuHardwareMatrixCase['storage'][] = supportedStorage.length
                ? supportedStorage.map(item => item === 'virtio-block' ? 'virtio-blk' : item)
                : [baselineStorage];
            const networks: InuHardwareMatrixCase['network'][] = ['none', ...supportedNetwork];
            const graphics: InuHardwareMatrixCase['graphics'][] = wantsVirtioGpu ? ['gop', 'virtio-gpu'] : ['gop'];
            const usbModes: InuHardwareMatrixCase['usb'][] = wantsXhci ? ['none', 'xhci'] : ['none'];
            for (const cpuCount of cpuCounts) for (const memoryMiB of memories) for (const storage of storages) for (const network of networks) for (const gpu of graphics) for (const usb of usbModes) {
                const drivers = [...platformDrivers, ...inputDrivers];
                const storageDriver = storage === 'virtio-blk' ? 'virtio-block' : storage;
                if (supportedStorage.includes(storageDriver as 'virtio-block' | 'ahci' | 'nvme')) drivers.push(storageDriver);
                if (network !== 'none') drivers.push(network);
                if (gpu === 'virtio-gpu') drivers.push('virtio-gpu');
                if (usb === 'xhci') drivers.push('usb-xhci', ...configuration.input.filter(item => item.startsWith('usb-hid-')));
                addSpec({ cpuCount, memoryMiB, storage, network, graphics: gpu, usb, firmware: 'uefi' }, drivers);
            }
            if (biosSupported && configuration.bootArchitecture !== 'uefi') addSpec({ ...base, firmware: 'bios' }, [...baseDrivers]);
        }

        const cases = [...specs.values()].map((spec, index) => ({
            ...spec,
            id: `hw-${String(index + 1).padStart(3, '0')}`,
            label: `${spec.cpuCount} CPU / ${spec.memoryMiB} MiB / ${spec.storage} / ${spec.network} / ${spec.graphics} / ${spec.usb} / ${spec.firmware.toUpperCase()}`,
            status: spec.firmware === 'bios' && !biosSupported ? 'skipped' as const : 'pending' as const,
            message: spec.firmware === 'bios' && !biosSupported ? 'Not applicable: current Inu x64 image is EFI/UEFI-only.' : undefined
        }));
        const caseIds = (predicate: (item: InuHardwareMatrixCase) => boolean) => cases.filter(predicate).map(item => item.id);
        const coverage: InuHardwareValidationCoverage[] = [];
        const addCoverage = (driverId: string, device: string, category: InuHardwareValidationCoverage['category'], status: InuHardwareValidationCoverage['status'], ids: string[], message: string) => {
            if (!coverage.some(item => item.driverId === driverId)) coverage.push({ driverId, device, category, status, caseIds: ids, message });
        };
        for (const driver of configuration.drivers) {
            if (driver === 'pci') addCoverage(driver, 'Q35 PCIe root complex', 'platform', 'implicit', cases.map(item => item.id), 'Present in every QEMU validation boot.');
            else if (driver === 'acpi') addCoverage(driver, 'Q35 ACPI tables / OVMF', 'platform', 'implicit', cases.map(item => item.id), 'Present in every UEFI Q35 validation boot.');
            else if (driver === 'serial-16550') addCoverage(driver, 'QEMU serial UART', 'platform', 'implicit', cases.map(item => item.id), 'Serial output is captured for every validation case.');
            else if (driver === 'virtio-console') addCoverage(driver, 'VirtIO serial + console', 'platform', 'emulated', caseIds(item => item.drivers.includes('virtio-console')), 'Kath attaches a VirtIO console transport during selected-driver validation.');
            else if (driver === 'virtio-rng') addCoverage(driver, 'VirtIO RNG', 'platform', 'not-emulated', [], 'Selected by the OS, but Kath does not yet attach a portable host RNG backend in the automatic matrix.');
            else if (driver === 'usb-xhci') addCoverage(driver, 'QEMU xHCI controller', 'usb', 'emulated', caseIds(item => item.usb === 'xhci'), 'Kath attaches xHCI with USB keyboard and mouse devices.');
            else if (driver === 'usb-ehci') addCoverage(driver, 'USB EHCI controller', 'usb', 'not-emulated', [], 'Selected by the OS, but the automatic matrix does not yet provide an isolated EHCI fixture.');
        }
        for (const storage of configuration.storageControllers) {
            if (storage === 'virtio-block') addCoverage(storage, 'VirtIO block PCI disk', 'storage', 'emulated', caseIds(item => item.storage === 'virtio-blk'), 'Validated with the same Debug OS image through VirtIO block.');
            else if (storage === 'ahci') addCoverage(storage, 'ICH9 AHCI + SATA disk', 'storage', 'emulated', caseIds(item => item.storage === 'ahci'), 'Validated through a real emulated AHCI controller, not the legacy IDE path.');
            else if (storage === 'nvme') addCoverage(storage, 'QEMU NVMe namespace', 'storage', 'emulated', caseIds(item => item.storage === 'nvme'), 'Validated through the QEMU NVMe controller/namespace path.');
        }
        for (const network of configuration.networkDrivers) {
            if (network === 'virtio-net') addCoverage(network, 'VirtIO network PCI adapter', 'network', 'emulated', caseIds(item => item.network === 'virtio-net'), 'Kath provides a user-mode VirtIO network device.');
            else if (network === 'e1000') addCoverage(network, 'Intel E1000 adapter', 'network', 'emulated', caseIds(item => item.network === 'e1000'), 'Kath provides QEMU E1000 hardware.');
            else if (network === 'rtl8168') addCoverage(network, 'Realtek RTL8168/8111', 'network', 'not-emulated', [], 'QEMU does not provide a compatible RTL8168/8111 device; physical-hardware validation remains required.');
        }
        for (const graphics of configuration.graphics) {
            if (graphics === 'virtio-gpu') addCoverage(graphics, 'VirtIO VGA/GPU', 'graphics', 'emulated', caseIds(item => item.graphics === 'virtio-gpu'), 'Kath boots dedicated VirtIO-GPU validation cases.');
            else if (graphics === 'uefi-gop') addCoverage(graphics, 'OVMF UEFI GOP', 'graphics', 'implicit', caseIds(item => item.firmware === 'uefi'), 'Provided by OVMF during every UEFI validation boot.');
            else if (graphics === 'generic-framebuffer') addCoverage(graphics, 'QEMU standard framebuffer/GOP handoff', 'graphics', 'implicit', caseIds(item => item.graphics === 'gop'), 'Covered by the standard framebuffer control cases.');
        }
        for (const input of configuration.input) {
            if (input === 'ps2-keyboard' || input === 'ps2-mouse') addCoverage(input, `Q35 ${input === 'ps2-keyboard' ? 'PS/2 keyboard' : 'PS/2 mouse'}`, 'input', 'implicit', cases.map(item => item.id), 'Q35 exposes the legacy PS/2 input path in normal validation boots.');
            else if (input === 'usb-hid-keyboard' || input === 'usb-hid-mouse') addCoverage(input, `xHCI ${input === 'usb-hid-keyboard' ? 'USB keyboard' : 'USB mouse'}`, 'input', 'emulated', caseIds(item => item.usb === 'xhci'), 'Kath attaches a matching USB HID device behind xHCI.');
        }
        return { cases, coverage };
    }

    protected async executeHardwareMatrix(projectRoot: string, run: { output: string; complete: boolean; exitCode?: number; error?: string; cases: InuHardwareMatrixCase[]; coverage: InuHardwareValidationCoverage[] }): Promise<void> {
        const qemuPath = await this.resolveQemuExecutable();
        const ovmfCode = await this.resolveQemuFile(['edk2-x86_64-code.fd', 'OVMF_CODE.fd']);
        const ovmfVars = await this.resolveQemuFile(['edk2-i386-vars.fd', 'edk2-x86_64-vars.fd', 'OVMF_VARS.fd']);
        if (!qemuPath) throw new Error('QEMU x86_64 was not found. Install/verify the Inu SDK toolchain first.');
        if (!ovmfCode || !ovmfVars) throw new Error('OVMF firmware was not found in the QEMU installation.');

        run.output += '[INFO] Building the selected OS explicitly in Debug mode before hardware validation.\r\n';
        const debugBuildPath = path.join(INU_SDK_ROOT, 'Build-Inu.bat');
        const projectManifestPath = path.join(projectRoot, 'InuProject.json');
        await fs.access(debugBuildPath);
        await fs.access(projectManifestPath);
        const build = await this.captureProcess(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', debugBuildPath, projectManifestPath, '-Configuration', 'Debug', '-NoRun'], projectRoot);
        run.output += build.output;
        if (build.exitCode !== 0) throw new Error(`Debug OS build failed with exit code ${build.exitCode}. No QEMU validation cases were run.`);

        const artifactRoot = path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel');
        const uefiImage = path.join(artifactRoot, 'MinimalKernel.img');
        const biosImage = path.join(artifactRoot, 'MinimalKernel-bios.img');
        await fs.access(uefiImage);
        const matrixRoot = path.join(projectRoot, '.inu', 'tests', 'debug-hardware-validation', new Date().toISOString().replace(/[:.]/g, '-'));
        await fs.mkdir(matrixRoot, { recursive: true });
        run.output += `[ OK ] Debug validation build completed.\r\n[INFO] Results: ${matrixRoot}\r\n\r\n`;

        for (const testCase of run.cases) {
            if (testCase.status === 'skipped') {
                run.output += `[SKIP] ${testCase.id} ${testCase.label}: ${testCase.message}\r\n`;
                continue;
            }
            testCase.status = 'running';
            const started = Date.now();
            run.output += `[RUN ] ${testCase.id} ${testCase.label}${testCase.drivers.length ? ` [${testCase.drivers.join(', ')}]` : ''}\r\n`;
            try {
                const caseRoot = path.join(matrixRoot, testCase.id);
                await fs.mkdir(caseRoot, { recursive: true });
                const serialLog = path.join(caseRoot, 'serial.log');
                testCase.serialLogPath = serialLog;
                const sourceImage = testCase.firmware === 'bios' ? biosImage : uefiImage;
                const caseImage = path.join(caseRoot, 'validation-disk.img');
                await fs.copyFile(sourceImage, caseImage);
                const args = await this.hardwareMatrixQemuArguments(testCase, caseImage, serialLog, ovmfCode, ovmfVars, caseRoot);
                const accepted = await this.runQemuAcceptance(qemuPath, args, projectRoot, serialLog, 60_000);
                testCase.durationMs = Date.now() - started;
                testCase.status = accepted.success ? 'passed' : 'failed';
                testCase.message = accepted.message;
                run.output += `${accepted.success ? '[ OK ]' : '[FAIL]'} ${testCase.id} ${accepted.message} (${(testCase.durationMs / 1000).toFixed(1)}s)\r\n`;
                if (!accepted.success) {
                    run.output += `[INFO] QEMU arguments: ${args.map(value => /\s/.test(value) ? `"${value}"` : value).join(' ')}\r\n`;
                    if (accepted.serialTail) run.output += `[INFO] Serial tail follows:\r\n${accepted.serialTail}\r\n[INFO] End serial tail.\r\n`;
                    if (testCase.id === 'hw-001') {
                        const reason = 'Skipped because the known-good Debug control boot failed; hardware variations were not executed.';
                        for (const remaining of run.cases) if (remaining.status === 'pending') { remaining.status = 'skipped'; remaining.message = reason; }
                        run.output += `[FAIL] Debug control boot failed. Remaining validation cases were skipped so one control failure cannot produce false driver failures.\r\n`;
                        break;
                    }
                }
            } catch (error) {
                testCase.durationMs = Date.now() - started;
                testCase.status = 'failed';
                testCase.message = error instanceof Error ? error.message : String(error);
                run.output += `[FAIL] ${testCase.id} ${testCase.message}\r\n`;
            }
        }
        const passed = run.cases.filter(item => item.status === 'passed').length;
        const failed = run.cases.filter(item => item.status === 'failed').length;
        const skipped = run.cases.filter(item => item.status === 'skipped').length;
        const report = { schemaVersion: 2, product: 'Kath', version: KATH_VERSION, mode: 'Debug', generatedUtc: new Date().toISOString(), passed, failed, skipped, coverage: run.coverage, cases: run.cases };
        await fs.writeFile(path.join(matrixRoot, 'Inu.DebugHardwareValidation.json'), JSON.stringify(report, null, 2), 'utf8');
        run.output += `\r\n[INFO] Debug hardware validation summary: ${passed} passed, ${failed} failed, ${skipped} skipped.\r\n`;
        run.output += `[INFO] JSON report: ${path.join(matrixRoot, 'Inu.DebugHardwareValidation.json')}\r\n`;
        run.exitCode = failed === 0 ? 0 : 1;
        run.complete = true;
    }

    protected async hardwareMatrixQemuArguments(testCase: InuHardwareMatrixCase, imagePath: string, serialLog: string, ovmfCode: string, ovmfVars: string, caseRoot: string): Promise<string[]> {
        const args = ['-machine', 'q35', '-accel', 'tcg,thread=multi', '-cpu', 'max', '-smp', String(testCase.cpuCount), '-m', `${testCase.memoryMiB}M`, '-display', 'sdl'];
        if (testCase.firmware === 'uefi') {
            const varsCopy = path.join(caseRoot, 'OVMF_VARS.fd');
            await fs.copyFile(ovmfVars, varsCopy);
            args.push('-drive', `if=pflash,format=raw,unit=0,readonly=on,file=${ovmfCode}`, '-drive', `if=pflash,format=raw,unit=1,file=${varsCopy}`);
        }
        args.push('-drive', `if=none,format=raw,file=${imagePath},id=boot`);
        if (testCase.storage === 'virtio-blk') args.push('-device', 'virtio-blk-pci,disable-legacy=on,drive=boot,bootindex=0');
        else if (testCase.storage === 'ahci') args.push('-device', 'ich9-ahci,id=ahci', '-device', 'ide-hd,drive=boot,bus=ahci.0,bootindex=0');
        else args.push('-device', 'nvme,drive=boot,serial=INUTEST,bootindex=0');
        if (testCase.network !== 'none') {
            args.push('-netdev', 'user,id=net0');
            args.push('-device', testCase.network === 'e1000' ? 'e1000,netdev=net0' : 'virtio-net-pci,netdev=net0');
        }
        if (testCase.graphics === 'virtio-gpu') args.push('-device', 'virtio-vga'); else args.push('-vga', 'std');
        if (testCase.usb === 'xhci') args.push('-device', 'qemu-xhci,id=xhci', '-device', 'usb-kbd,bus=xhci.0', '-device', 'usb-mouse,bus=xhci.0');
        if (testCase.drivers.includes('virtio-console')) args.push('-chardev', 'null,id=inu-vconsole', '-device', 'virtio-serial-pci,id=inu-vserial', '-device', 'virtconsole,chardev=inu-vconsole');
        args.push('-boot', 'order=c,menu=off,strict=on', '-serial', `file:${serialLog}`, '-monitor', 'none', '-no-reboot', '-no-shutdown');
        return args;
    }

    protected async runQemuAcceptance(qemuPath: string, args: string[], cwd: string, serialLog: string, timeoutMs: number): Promise<{ success: boolean; message: string; serialTail?: string }> {
        await fs.rm(serialLog, { force: true }).catch(() => undefined);
        const child = spawn(qemuPath, args, { cwd, windowsHide: true, stdio: 'ignore' });
        let exited = false; let exitCode: number | null = null;
        child.on('close', code => { exited = true; exitCode = code; });
        try {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                if (exited) return { success: false, message: `QEMU exited before boot acceptance (exit code ${exitCode ?? -1}).` };
                const serial = await fs.readFile(serialLog, 'utf8').catch(() => '');
                if (serial.includes('Inu KMain started.') && serial.includes('Inu> ')) return { success: true, message: 'KMain and interactive Inu prompt confirmed.' };
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            const serial = await fs.readFile(serialLog, 'utf8').catch(() => '');
            const serialTail = serial.length > 6000 ? serial.slice(-6000) : serial;
            if (!serial) return { success: false, message: 'Timed out before any Inu serial output appeared.' };
            if (!serial.includes('Inu KMain started.')) return { success: false, message: 'Timed out before Inu KMain started.', serialTail };
            return { success: false, message: 'KMain started, but the interactive Inu prompt was not reached.', serialTail };
        } finally {
            if (!exited) {
                try { child.kill(); } catch { }
            }
        }
    }

    protected async captureProcess(command: string, args: string[], cwd: string): Promise<{ exitCode: number; output: string }> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
            child.stdout?.on('data', data => { output += data; }); child.stderr?.on('data', data => { output += data; });
            child.on('error', reject); child.on('close', code => resolve({ exitCode: code ?? 1, output }));
        });
    }

    protected async resolveQemuExecutable(): Promise<string | undefined> {
        const candidates = [process.env.INU_QEMU_X64, 'C:\\Program Files\\qemu\\qemu-system-x86_64.exe'].filter((value): value is string => !!value);
        for (const candidate of candidates) if (await this.exists(candidate)) return candidate;
        return undefined;
    }

    protected async resolveQemuFile(names: string[]): Promise<string | undefined> {
        const roots = ['C:\\Program Files\\qemu\\share', 'C:\\Program Files\\qemu'];
        for (const root of roots) for (const name of names) {
            const candidate = path.join(root, name); if (await this.exists(candidate)) return candidate;
        }
        return undefined;
    }



    async runOperatingSystem(projectPath: string, mode: InuRunMode, breakpoints: InuBreakpointRequest[] = [], exceptionBreakpoints: InuExceptionBreakpointSettings = { vectors: [0, 6, 8, 12, 13, 14, 18], breakOnPanic: true, nmiOptIn: false }): Promise<InuRunResult> {
        try {
            const projectRoot = this.requireOperatingSystemRoot(projectPath);
            await fs.access(path.join(projectRoot, 'Inu.json'));
            await this.refreshAuthoritativeRuntimeConfiguration(projectRoot);
            await this.refreshSdkBridge(projectRoot);
            const activeTarget = await this.getActiveTarget(projectRoot);
            if (!activeTarget) return { success: false, error: 'Inu Target Manager has no active target.' };
            if (activeTarget.kind === 'remote') return { success: false, error: `${activeTarget.name} is a remote target. Kath 0.33.21 implements direct physical-machine GDB transport; generic remote-agent execution remains reserved for a later transport.` };
            if (activeTarget.kind === 'physical' && mode !== 'debug') return { success: false, error: `${activeTarget.name} is a physical target. Use Debug to build the kernel and attach to the configured hardware GDB endpoint; Release Run cannot automatically boot a physical machine.` };
            if (activeTarget.architecture !== 'x86_64') return { success: false, error: `${activeTarget.name} targets ${activeTarget.architecture}. The current bundled Inu build/debug transport is x86_64; the target remains stored until that architecture backend is installed.` };

            const runPath = path.join(projectRoot, 'Run.bat');
            if (mode !== 'debug') await fs.access(runPath);
            const debugBuildPath = path.join(INU_SDK_ROOT, 'Build-Inu.bat');
            const projectManifestPath = path.join(projectRoot, 'InuProject.json');
            if (mode === 'debug') {
                await fs.access(debugBuildPath);
                await fs.access(projectManifestPath);
            }

            const modeArgument = mode === 'debug' ? 'Debug' : 'Run';
            const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            const session: RunSession = {
                sessionId, output: '', complete: false, mode, projectRoot, target: activeTarget,
                breakpoints: new Map<string, SourceBreakpoint>(),
                requestedBreakpoints: breakpoints.map(item => ({ sourcePath: path.resolve(item.sourcePath), line: item.line, condition: item.condition?.trim() || undefined, hitCondition: item.hitCondition?.trim() || undefined })),
                breakpointResults: [],
                exceptionBreakpoints: { vectors: Array.from(new Set((exceptionBreakpoints.vectors ?? []).filter(vector => Number.isInteger(vector) && vector >= 0 && vector < 32 && (vector !== 2 || exceptionBreakpoints.nmiOptIn === true)))), breakOnPanic: !!exceptionBreakpoints.breakOnPanic, nmiOptIn: exceptionBreakpoints.nmiOptIn === true },
                exceptionBreakpointAddresses: new Map<bigint, number>,
                debug: mode === 'debug' ? { active: false, paused: false, sourceSymbols: false, message: 'Building Debug kernel…' } : undefined,
                startedAtMs: Date.now(), telemetryBuffer: '', traceEvents: [], bootStages: new Map<string, InuBootStage>(),
                profileSamples: new Map(), profileCpuSamples: new Map(), profileCounters: new Map()
            };
            this.runSessions.set(sessionId, session);

            // Debug owns its QEMU/GDB transport. Build the Debug image explicitly with -NoRun so
            // stale/generated OS launchers can never start the SDK acceptance QEMU and race the IDE debugger.
            const launchArguments = mode === 'debug'
                ? ['/d', '/c', 'call', debugBuildPath, projectManifestPath, '-Configuration', 'Debug', '-NoRun', '-ForceRebuild']
                : ['/d', '/c', 'call', runPath, modeArgument];
            const child = spawn('cmd.exe', launchArguments, {
                cwd: projectRoot,
                detached: false,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    INU_TARGET_ID: activeTarget.id,
                    INU_TARGET_NAME: activeTarget.name,
                    INU_TARGET_KIND: activeTarget.kind,
                    INU_TARGET_ARCH: activeTarget.architecture,
                    INU_TARGET_CPUS: String(activeTarget.qemu?.cpuCount ?? 1),
                    INU_TARGET_MEMORY_MIB: String(activeTarget.qemu?.memoryMiB ?? 512),
                    INU_TARGET_MACHINE: activeTarget.qemu?.machine ?? 'q35',
                    INU_TARGET_ACCELERATOR: activeTarget.qemu?.accelerator ?? 'tcg',
                    INU_TARGET_DISPLAY: activeTarget.qemu?.display ?? 'sdl'
                }
            });

            session.launchProcess = child;
            child.stdout?.setEncoding('utf8');
            child.stderr?.setEncoding('utf8');
            child.stdout?.on('data', data => { session.output += data; });
            child.stderr?.on('data', data => { session.output += data; });
            child.on('error', error => {
                if (session.complete && session.stoppedByUser) { return; }
                session.error = error.message;
                session.output += `\r\n[FAIL] ${error.message}\r\n`;
                session.complete = true;
            });
            child.on('close', code => {
                session.launchProcess = undefined;
                if (session.complete) {
                    return;
                }
                if (mode === 'debug' && code === 0 && session.output.includes('[FAIL]')) {
                    session.error = 'Inu Debug reported a build failure before the debugger could start.';
                    session.output += `\r\n[FAIL] ${session.error}\r\n`;
                    session.exitCode = 1;
                    session.complete = true;
                    return;
                }
                if (mode === 'debug' && code === 0) {
                    const launcher = activeTarget.kind === 'physical'
                        ? this.launchPhysicalDebugger(session, activeTarget)
                        : this.launchDebugQemu(session);
                    void launcher.catch(error => {
                        session.error = error instanceof Error ? error.message : String(error);
                        session.output += `\r\n[FAIL] ${session.error}\r\n`;
                        session.physicalSerial?.kill();
                        session.complete = true;
                        session.exitCode = 1;
                    });
                    return;
                }
                if (mode !== 'debug' && code === 0) {
                    const currentIdentity = this.currentNoDebugQemuIdentity(session.output);
                    const runtimeAccepted = this.noDebugRuntimeAcceptanceSucceeded(session.output);
                    if (!runtimeAccepted && !currentIdentity.qemuPid) {
                        // A legacy/generated batch bridge can accidentally return 0 even when the
                        // SDK script terminated with a PowerShell exception.  Never consult the
                        // shared Inu.Run.json in that case: without current-session acceptance
                        // markers there is no QEMU instance from this Run command to attach to.
                        session.error = session.output.includes('[FAIL]')
                            ? (session.output.includes('[ OK ] QEMU started')
                                ? 'Inu Run failed during QEMU runtime acceptance; see the preceding kernel diagnostics.'
                                : 'Inu Run reported a build failure before QEMU started.')
                            : 'Inu Run ended before QEMU runtime acceptance and did not publish a current QEMU identity.';
                        session.output += `\r\n[FAIL] ${session.error}\r\n`;
                        session.exitCode = 1;
                        session.complete = true;
                        return;
                    }
                    if (runtimeAccepted) {
                        session.output += `\r\n[ OK ] Kath runtime acceptance confirmed.\r\n`;
                    }
                    void this.attachNoDebugQemuSession(session).catch(error => {
                        const message = error instanceof Error ? error.message : String(error);
                        if (runtimeAccepted) {
                            // Runtime acceptance is an SDK/build result. Live diagnostics attachment
                            // is a convenience after that result and must never reverse a successful
                            // acceptance merely because QEMU closed or host PID probing failed.
                            session.output += `\r\n[WARN] Runtime acceptance succeeded, but live QEMU diagnostics could not be attached: ${message}\r\n`;
                            if (currentIdentity.serialLogPath) session.output += `[INFO] Accepted guest serial remains available: ${currentIdentity.serialLogPath}\r\n`;
                            if (currentIdentity.diagnosticReportPath) session.output += `[INFO] Accepted stop-state diagnostics: ${currentIdentity.diagnosticReportPath}\r\n`;
                            session.exitCode = 0;
                            session.complete = true;
                            return;
                        }
                        session.error = message;
                        session.output += `\r\n[FAIL] Unable to attach live QEMU diagnostics: ${session.error}\r\n`;
                        session.exitCode = 1;
                        session.complete = true;
                    });
                    return;
                }
                session.exitCode = code ?? -1;
                session.complete = true;
            });

            return { success: true, sessionId };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message };
        }
    }

    protected terminateRunProcessTree(pid: number | undefined): void {
        if (!pid || pid <= 0) { return; }
        if (process.platform === 'win32') {
            try {
                const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
                    windowsHide: true,
                    stdio: 'ignore'
                });
                if (result.status === 0) { return; }
            } catch { }
        }
        try { process.kill(pid, 'SIGTERM'); } catch { }
    }

    async stopOperatingSystem(sessionId: string): Promise<InuRunResult> {
        const session = this.runSessions.get(sessionId);
        if (!session) {
            return { success: false, error: 'The Inu run session no longer exists.' };
        }
        if (session.complete && !session.launchProcess && !session.qemu && !session.qemuPid && !session.physicalSerial && !session.gdb && !session.qmpSocket) {
            return { success: true, sessionId };
        }

        session.stoppedByUser = true;
        session.output += '\r\n[INFO] Stop Run requested. Cancelling the active Inu run.\r\n';
        session.gdb?.close();
        session.qmpSocket?.destroy();
        session.qmpSocket = undefined;

        const launchPid = session.launchProcess?.pid;
        const qemuChildPid = session.qemu?.pid;
        const physicalSerialPid = session.physicalSerial?.pid;
        this.terminateRunProcessTree(launchPid);
        this.terminateRunProcessTree(qemuChildPid);
        if (session.qemuPid && session.qemuPid !== qemuChildPid) {
            this.terminateRunProcessTree(session.qemuPid);
        }
        this.terminateRunProcessTree(physicalSerialPid);

        try { session.launchProcess?.kill(); } catch { }
        try { session.qemu?.kill(); } catch { }
        try { session.physicalSerial?.kill(); } catch { }

        session.launchProcess = undefined;
        session.qemu = undefined;
        session.qemuPid = undefined;
        session.physicalSerial = undefined;
        if (session.debug) {
            session.debug = {
                ...session.debug,
                active: false,
                paused: false,
                message: 'Run cancelled by the user.'
            };
        }
        session.error = undefined;
        session.exitCode = 0;
        session.complete = true;
        session.output += '[ OK ] Inu run cancelled.\r\n';
        return { success: true, sessionId };
    }

    async runSdkCommand(projectPath: string, command: InuSdkCommand): Promise<InuSdkCommandRunResult> {
        try {
            const projectRoot = command === 'doctor' ? path.resolve(projectPath) : this.requireOperatingSystemRoot(projectPath);
            const allowed: InuSdkCommand[] = ['build', 'test', 'doctor'];
            if (!allowed.includes(command)) return { success: false, error: `Unsupported Inu SDK command: ${command}` };
            if (command !== 'doctor') {
                await fs.access(path.join(projectRoot, 'Inu.json'));
                await this.refreshAuthoritativeRuntimeConfiguration(projectRoot);
                await this.refreshSdkBridge(projectRoot);
            }
            const cli = path.join(INU_SDK_ROOT, 'inu.ps1');
            await fs.access(cli);
            const runId = `sdk-${command}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            const run = { output: `[INFO] Inu SDK command: ${command}
[INFO] Project: ${projectRoot}

`, complete: false } as { output: string; complete: boolean; exitCode?: number; error?: string };
            this.sdkCommandRuns.set(runId, run);
            const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cli, command];
            if (command === 'build') args.push('--project', projectRoot);
            const child = spawn('powershell.exe', args, { cwd: projectRoot, detached: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
            child.stdout?.on('data', data => { run.output += data; });
            child.stderr?.on('data', data => { run.output += data; });
            child.on('error', error => { run.error = error.message; run.output += `
[FAIL] ${error.message}
`; run.exitCode = 1; run.complete = true; });
            child.on('close', code => { if (run.complete) return; run.exitCode = code ?? 1; run.complete = true; });
            return { success: true, runId };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async readSdkCommandOutput(runId: string, offset: number): Promise<InuSdkCommandOutput> {
        const run = this.sdkCommandRuns.get(runId);
        if (!run) return { text: '', nextOffset: offset, complete: true, exitCode: 1, error: 'Unknown Inu SDK command run.' };
        const safeOffset = Math.max(0, Math.min(offset, run.output.length));
        const text = run.output.slice(safeOffset);
        if (run.complete) this.sdkCommandRuns.delete(runId);
        return { text, nextOffset: run.output.length, complete: run.complete, exitCode: run.exitCode, error: run.error };
    }

    protected noDebugRuntimeAcceptanceSucceeded(output: string): boolean {
        const managedAccepted = output.includes('[ OK ] Inu x64 NativeAOT boot-and-run acceptance completed.');
        return (managedAccepted) &&
            output.includes('[INFO] Accepted QEMU PID:') &&
            output.includes('[INFO] Accepted QEMU UTC:');
    }

    protected currentNoDebugQemuIdentity(output: string): { qemuPid?: number; serialLogPath?: string; diagnosticReportPath?: string; acceptedUtc?: string } {
        const identity: { qemuPid?: number; serialLogPath?: string; diagnosticReportPath?: string; acceptedUtc?: string } = {};
        for (const rawLine of output.replace(/\r/g, '').split('\n')) {
            const line = rawLine.trim();
            if (!line) continue;
            let match = /\[INFO\]\s+Accepted QEMU PID:\s*(\d+)/i.exec(line);
            if (match) { identity.qemuPid = Number(match[1]); continue; }
            match = /\[INFO\]\s+Accepted QEMU serial log:\s*(.+)$/i.exec(line);
            if (match) { identity.serialLogPath = match[1].trim(); continue; }
            match = /\[INFO\]\s+Accepted QEMU stop report:\s*(.+)$/i.exec(line);
            if (match) { identity.diagnosticReportPath = match[1].trim(); continue; }
            match = /\[INFO\]\s+Accepted QEMU UTC:\s*(.+)$/i.exec(line);
            if (match) { identity.acceptedUtc = match[1].trim(); }
        }
        return identity;
    }

    protected async attachNoDebugQemuSession(session: RunSession): Promise<void> {
        // Build-Inu.ps1 publishes the exact accepted QEMU identity into this Run.bat
        // session's own stdout. Prefer those markers so this Kath session can never bind
        // itself to an older accepted run merely because Inu.Run.json still exists.
        const current = this.currentNoDebugQemuIdentity(session.output);
        if (current.qemuPid && current.qemuPid > 0 && current.serialLogPath) {
            if (!this.isProcessAliveByPid(current.qemuPid)) {
                throw new Error(`The QEMU process accepted by this Run.bat session is no longer alive (PID ${current.qemuPid}).`);
            }
            await fs.access(current.serialLogPath);
            session.qemuPid = current.qemuPid;
            session.serialLogPath = current.serialLogPath;
            try { session.serialLogOffset = (await fs.readFile(current.serialLogPath, 'utf8')).length; } catch { session.serialLogOffset = 0; }
            session.diagnosticReportPath = current.diagnosticReportPath || undefined;
            session.diagnosticReportConsumed = false;
            session.output += `\r\n[INFO] Kath attached to current QEMU PID ${session.qemuPid}.\r\n`;
            session.output += `[INFO] Live guest serial: ${session.serialLogPath}\r\n`;
            if (session.diagnosticReportPath) session.output += `[INFO] Stop-state diagnostics: ${session.diagnosticReportPath}\r\n`;
            session.output += '[INFO] No Debug remains attached until QEMU closes or enters a non-running state.\r\n';
            return;
        }

        // Compatibility fallback for older launch bridges. A shared manifest is accepted only
        // when its acceptedUtc proves that it was created by this Kath run session. Never attach
        // to a valid-but-stale manifest from a previous QEMU process.
        const runManifestPath = path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel', 'Inu.Run.json');
        let manifest: any;
        let lastError = 'Current Run.bat output did not contain the accepted QEMU identity markers.';
        for (let attempt = 0; attempt < 40; attempt++) {
            try {
                const candidate = JSON.parse(await fs.readFile(runManifestPath, 'utf8'));
                const acceptedAtMs = Date.parse(String(candidate?.acceptedUtc ?? ''));
                const pid = Number(candidate?.qemuProcessId);
                const serialLog = typeof candidate?.serialLog === 'string' ? candidate.serialLog : '';
                if (Number.isFinite(acceptedAtMs) && acceptedAtMs >= session.startedAtMs && pid > 0 && serialLog) {
                    manifest = candidate;
                    break;
                }
                if (Number.isFinite(acceptedAtMs) && acceptedAtMs < session.startedAtMs) {
                    lastError = `Inu.Run.json belongs to an earlier accepted run (${new Date(acceptedAtMs).toISOString()}).`;
                } else {
                    lastError = 'Inu.Run.json does not contain a complete current-session QEMU identity.';
                }
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!manifest) {
            throw new Error(`Inu.Run.json did not expose the QEMU session started by this Run command. ${lastError}`);
        }
        session.qemuPid = Number(manifest.qemuProcessId);
        if (!this.isProcessAliveByPid(session.qemuPid)) {
            throw new Error(`The current Inu.Run.json QEMU process is no longer alive (PID ${session.qemuPid}).`);
        }
        const liveSerialLog = String(manifest.serialLog);
        session.serialLogPath = liveSerialLog;
        try { session.serialLogOffset = (await fs.readFile(liveSerialLog, 'utf8')).length; } catch { session.serialLogOffset = 0; }
        session.diagnosticReportPath = typeof manifest.diagnosticReport === 'string' ? manifest.diagnosticReport : undefined;
        session.diagnosticReportConsumed = false;
        session.output += `\r\n[INFO] Kath attached to current QEMU PID ${session.qemuPid} (manifest fallback).\r\n`;
        session.output += `[INFO] Live guest serial: ${session.serialLogPath}\r\n`;
        if (session.diagnosticReportPath) session.output += `[INFO] Stop-state diagnostics: ${session.diagnosticReportPath}\r\n`;
        session.output += '[INFO] No Debug remains attached until QEMU closes or enters a non-running state.\r\n';
    }

    protected isProcessAliveByPid(pid: number | undefined): boolean {
        if (!pid || pid <= 0) return false;
        try { process.kill(pid, 0); return true; } catch {
            // Node's signal-0 probe can report a false negative for QEMU launched by a detached
            // Windows Start-Process bridge even while the SDL process is visibly alive.  Use
            // tasklist as the Windows fallback so Kath does not reject the exact PID that the
            // current Inu run accepted and published.
            if (process.platform !== 'win32') return false;
            try {
                const probe = spawnSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
                if (probe.status !== 0) return false;
                const stdout = String(probe.stdout ?? '');
                return stdout.split(/\r?\n/).some(line => line.includes(`\"${pid}\"`));
            } catch { return false; }
        }
    }

    async readRunOutput(sessionId: string, offset: number): Promise<InuRunOutput> {
        const session = this.runSessions.get(sessionId);
        let kernelText = '';
        if (!session) {
            return {
                text: '',
                nextOffset: offset,
                complete: true,
                exitCode: -1,
                error: 'Inu run session was not found.'
            };
        }

        if (session.serialLogPath) {
            try {
                const serial = await fs.readFile(session.serialLogPath, 'utf8');
                const serialOffset = Math.max(0, Math.min(session.serialLogOffset ?? 0, serial.length));
                if (serial.length > serialOffset) {
                    const fresh = serial.slice(serialOffset).replace(/\r/g, '');
                    this.ingestTelemetry(session, fresh);
                    const serialLineProbe = `${session.serialDisplayPending ?? ''}${fresh}`;
                    if (!session.complete && /(?:^|\n)EH:18FF(?:\n|$)/.test(serialLineProbe)) {
                        session.error = 'The freestanding NativeAOT exception runtime entered FailFast (EH:18FF). The guest was halted before it could reach the interactive runtime.';
                        session.output += `\r\n[FAIL] ${session.error}\r\n`;
                        session.exitCode = 1;
                        session.complete = true;
                        session.debug = {
                            ...(session.debug ?? { sourceSymbols: false }),
                            active: false,
                            paused: false,
                            sourceSymbols: session.debug?.sourceSymbols ?? false,
                            message: session.error
                        };
                        session.gdb?.close();
                        session.qmpSocket?.destroy();
                        session.qmpSocket = undefined;
                        this.terminateRunProcessTree(session.qemu?.pid);
                        if (session.qemuPid && session.qemuPid !== session.qemu?.pid) this.terminateRunProcessTree(session.qemuPid);
                    }
                    if (fresh.includes('[[INU:SHELL_COPY_ALL]]')) {
                        const copyMarker = serial.lastIndexOf('[[INU:SHELL_COPY_ALL]]');
                        const beginMarker = serial.lastIndexOf('[[INU:SHELL_BEGIN]]', copyMarker);
                        if (beginMarker >= 0 && copyMarker > beginMarker) {
                            const transcriptStart = beginMarker + '[[INU:SHELL_BEGIN]]'.length;
                            const transcript = serial.slice(transcriptStart, copyMarker)
                                .replace(/\r/g, '')
                                .split('\n')
                                .filter(line => !/^\[\[INU:[A-Z0-9_]+\]\]$/.test(line.trim()))
                                .join('\r\n')
                                .replace(/^\s+/, '');
                            if (transcript.length > 0) {
                                await this.copyTextToWindowsClipboard(transcript);
                                session.output += '\r\n[ OK ] Inu shell transcript copied to Windows clipboard (Ctrl+A, Ctrl+C).\r\n';
                            }
                        }
                    }
                    // Serial output is written byte-by-byte by the freestanding kernel. Never
                    // label a partially-written line: polling in the middle of KernelConsole.Write()
                    // used to turn one logical record into several unrelated [KERNEL] fragments.
                    const displayText = serialLineProbe;
                    const displayParts = displayText.split('\n');
                    const endedWithNewline = displayText.endsWith('\n');
                    let pending = endedWithNewline ? '' : (displayParts.pop() ?? '');
                    if (endedWithNewline && displayParts.length > 0 && displayParts[displayParts.length - 1] === '') {
                        displayParts.pop();
                    }
                    // The interactive shell prompt is intentionally not newline-terminated. It is a
                    // complete presentation record once emitted, so surface it immediately.
                    if (pending.endsWith('Inu> ')) {
                        displayParts.push(pending);
                        pending = '';
                    }
                    session.serialDisplayPending = pending;
                    const kernelLines = displayParts
                        .filter(line => !/^\[\[INU:[A-Z0-9_]+\]\]$/.test(line.trim()));
                    if (kernelLines.length > 0) {
                        kernelText = `${kernelLines.join('\n')}\n`;
                    }
                    session.serialLogOffset = serial.length;
                }
            } catch { }
        }
        if (session.diagnosticReportPath && !session.diagnosticReportConsumed) {
            try {
                const diagnostics = await fs.readFile(session.diagnosticReportPath, 'utf8');
                if (diagnostics.trim().length > 0) {
                    session.diagnosticReportConsumed = true;
                    const processExited = /observedStatus:\s*process-exited/i.test(diagnostics);
                    if (processExited) {
                        session.output += '\r\n[INFO] QEMU closed. Final host/guest diagnostics were captured.\r\n';
                        session.exitCode = 0;
                    } else {
                        session.output += '\r\n[FAIL] QEMU entered a non-running state. Automatic stop-state diagnostics follow.\r\n';
                        session.output += diagnostics.replace(/\n/g, '\r\n');
                        session.error = 'QEMU entered a non-running state; automatic diagnostics were captured.';
                        session.exitCode = 1;
                    }
                    session.complete = true;
                }
            } catch { }
        }
        if (!session.complete && session.mode !== 'debug' && session.qemuPid && !this.isProcessAliveByPid(session.qemuPid)) {
            session.output += '\r\n[INFO] QEMU process exited.\r\n';
            session.exitCode = 0;
            session.complete = true;
        }

        const safeOffset = Math.max(0, Math.min(offset, session.output.length));
        const text = session.output.slice(safeOffset);
        const nextOffset = session.output.length;
        const result: InuRunOutput = {
            text,
            kernelText,
            nextOffset,
            complete: session.complete,
            exitCode: session.exitCode,
            error: session.error
        };

        if (session.complete && nextOffset === session.output.length) {
            this.telemetryArchives.set(session.projectRoot, { trace: this.traceSnapshotForSession(session), profiler: this.profilerSnapshotForSession(session) });
            setTimeout(() => this.runSessions.delete(sessionId), 60_000);
        }
        return result;
    }

    async readTraceSnapshot(projectPath: string): Promise<InuTraceSnapshot> {
        const session = this.latestSessionForProject(projectPath);
        if (session) { return this.traceSnapshotForSession(session); }
        return this.telemetryArchives.get(path.resolve(projectPath))?.trace ?? { active: false, capturedAtUtc: new Date().toISOString(), elapsedMs: 0, events: [], bootStages: [], message: 'Run or Debug the operating system to collect kernel trace data.' };
    }

    async saveTrace(projectPath: string): Promise<InuTraceSaveResult> {
        try {
            const root = path.resolve(projectPath);
            const snapshot = await this.readTraceSnapshot(root);
            if (snapshot.events.length === 0 && snapshot.bootStages.length === 0) return { success: false, error: 'No Inu trace data has been collected yet.' };
            const directory = path.join(root, '.inu', 'traces');
            await fs.mkdir(directory, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filePath = path.join(directory, `Inu-Trace-${stamp}.notrace.json`);
            await fs.writeFile(filePath, JSON.stringify({ schema: 'inu-trace/v1', ...snapshot }, undefined, 2), 'utf8');
            return { success: true, path: filePath };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    }

    async resetTrace(projectPath: string): Promise<InuTraceSnapshot> {
        const session = this.latestSessionForProject(projectPath);
        if (session) { session.traceEvents.length = 0; session.bootStages.clear(); session.currentBootStage = undefined; return this.traceSnapshotForSession(session); }
        this.telemetryArchives.delete(path.resolve(projectPath));
        return { active: false, capturedAtUtc: new Date().toISOString(), elapsedMs: 0, events: [], bootStages: [], message: 'Trace data cleared.' };
    }

    async readProfilerSnapshot(projectPath: string): Promise<InuProfilerSnapshot> {
        const session = this.latestSessionForProject(projectPath);
        if (session) return this.profilerSnapshotForSession(session);
        return this.telemetryArchives.get(path.resolve(projectPath))?.profiler ?? { active: false, capturedAtUtc: new Date().toISOString(), elapsedMs: 0, totalSamples: 0, functions: [], cpus: [], counters: [], message: 'Run or Debug the operating system to collect profiling telemetry.' };
    }

    async resetProfiler(projectPath: string): Promise<InuProfilerSnapshot> {
        const session = this.latestSessionForProject(projectPath);
        if (session) { session.profileSamples.clear(); session.profileCpuSamples.clear(); session.profileCounters.clear(); return this.profilerSnapshotForSession(session); }
        const archived = this.telemetryArchives.get(path.resolve(projectPath));
        if (archived) archived.profiler = { active: false, capturedAtUtc: new Date().toISOString(), elapsedMs: 0, totalSamples: 0, functions: [], cpus: [], counters: [], message: 'Profiler data cleared.' };
        return archived?.profiler ?? { active: false, capturedAtUtc: new Date().toISOString(), elapsedMs: 0, totalSamples: 0, functions: [], cpus: [], counters: [], message: 'Profiler data cleared.' };
    }

    async debugState(sessionId: string): Promise<InuDebugState> {
        const session = this.runSessions.get(sessionId);
        return session?.debug
            ? { ...session.debug, breakpoints: session.breakpointResults.map(item => ({ ...item })) }
            : { active: false, paused: false, sourceSymbols: false, message: 'No active Inu debug session.' };
    }

    async debugCommand(sessionId: string, command: InuDebugCommand): Promise<InuDebugState> {
        const session = this.runSessions.get(sessionId);
        if (!session || session.mode !== 'debug' || !session.debug) {
            return { active: false, paused: false, sourceSymbols: false, message: 'No active Inu debug session.' };
        }
        if (command === 'stop') {
            session.stepPlan = undefined;
            session.gdb?.close();
            session.qemu?.kill();
            session.physicalSerial?.kill();
            session.debug = { ...session.debug, active: false, paused: false, message: 'Debug session stopped.' };
            session.complete = true;
            session.exitCode = 0;
            return session.debug;
        }
        if (command === 'restart') {
            session.gdb?.close();
            session.qemu?.kill();
            session.physicalSerial?.kill();
            session.breakpoints.clear();
            session.lastBreakpoint = undefined;
            session.stepPlan = undefined;
            const physical = session.target?.kind === 'physical';
            session.debug = { active: false, paused: false, sourceSymbols: session.debug.sourceSymbols, message: physical ? 'Reattaching physical-machine debugger…' : 'Restarting QEMU debugger…' };
            if (physical && session.target) await this.launchPhysicalDebugger(session, session.target);
            else await this.launchDebugQemu(session);
            return session.debug!;
        }
        if (!session.gdb || !session.debug.active) {
            return { ...session.debug, message: 'QEMU debugger is not attached yet.' };
        }
        if (command === 'pause') {
            session.gdb.interrupt();
            session.debug = { ...session.debug, message: 'Pause requested…' };
            return session.debug;
        }
        if (command === 'continue') {
            await this.clearTemporaryStepBreakpoint(session);
            session.stepPlan = undefined;
            session.gdb.run('c');
            session.debug = this.runningDebugState(session, 'Kernel running. Waiting for breakpoint.');
            return session.debug;
        }
        if (!session.debug.paused) {
            return { ...session.debug, message: 'Step commands are available after a breakpoint or Pause.' };
        }

        if (command === 'step-out') {
            const rbp = await this.readRegister(session.gdb, 6);
            const returnAddress = rbp !== 0n ? await this.readU64(session.gdb, rbp + 8n) : 0n;
            if (returnAddress === 0n) {
                return { ...session.debug, message: 'Step Out could not determine the current frame return address.' };
            }
            const reply = await session.gdb.command(`Z0,${returnAddress.toString(16)},1`);
            if (reply !== 'OK') {
                return { ...session.debug, message: `Step Out temporary breakpoint was rejected by QEMU: ${reply}` };
            }
            session.stepPlan = { kind: 'step-out', sourcePath: session.debug.sourcePath, line: session.debug.line, machineSteps: 0, temporaryAddress: returnAddress };
            session.gdb.run('c');
            session.debug = this.runningDebugState(session, 'Step Out running to the caller…');
            return session.debug;
        }

        session.stepPlan = {
            kind: command,
            sourcePath: session.debug.sourcePath,
            line: session.debug.line,
            machineSteps: 0
        };
        await this.advanceStepPlan(session);
        return session.debug!;
    }

    async toggleBreakpoint(sessionId: string, sourcePath: string, line: number, condition?: string, hitCondition?: string): Promise<InuBreakpointResult> {
        const session = this.runSessions.get(sessionId);
        if (!session || session.mode !== 'debug' || !session.gdb || !session.debug?.active) {
            return { success: false, verified: false, sourcePath, line, message: 'The debugger is still preparing the kernel image. Try again when the toolbar shows Running.' };
        }

        const normalizedSource = path.resolve(sourcePath);
        const key = `${normalizedSource.toLowerCase()}:${line}`;
        const existing = session.breakpoints.get(key);
        const pendingResult = session.breakpointResults.find(item =>
            path.resolve(item.sourcePath).toLowerCase() === normalizedSource.toLowerCase() && item.line === line);
        const wasPaused = session.debug.paused;
        if (!wasPaused) {
            session.internalPause = true;
            session.gdb.interrupt();
            await this.waitForPause(session, 1200);
        }

        try {
            // A stored breakpoint that failed to bind is not present in session.breakpoints.
            // When Theia removes that pending breakpoint, treat this call as removal rather
            // than accidentally attempting to arm it again.
            if (!existing && pendingResult && !pendingResult.verified) {
                session.breakpointResults = session.breakpointResults.filter(item =>
                    !(path.resolve(item.sourcePath).toLowerCase() === normalizedSource.toLowerCase() && item.line === line));
                if (!wasPaused) {
                    session.gdb.run('c');
                    session.debug = { ...session.debug!, paused: false, sourcePath: undefined, line: undefined, message: 'Kernel running. Waiting for breakpoint.' };
                }
                return { success: true, verified: false, sourcePath, line, message: 'Unverified breakpoint removed.' };
            }

            if (existing) {
                const reply = await session.gdb.command(`z0,${existing.address},1`);
                session.breakpoints.delete(key);
                session.breakpointResults = session.breakpointResults.filter(item =>
                    !(path.resolve(item.sourcePath).toLowerCase() === normalizedSource.toLowerCase() && item.line === line));
                if (!wasPaused) {
                    session.gdb.run('c');
                    session.debug = { ...session.debug!, paused: false, sourcePath: undefined, line: undefined, message: 'Kernel running. Waiting for breakpoint.' };
                }
                return { success: reply === 'OK', verified: false, sourcePath, line, address: existing.address, message: 'Breakpoint removed.' };
            }

            const result = await this.armSourceBreakpoint(session, { sourcePath: normalizedSource, line, condition: condition?.trim() || undefined, hitCondition: hitCondition?.trim() || undefined });
            session.breakpointResults = session.breakpointResults.filter(item =>
                !(path.resolve(item.sourcePath).toLowerCase() === normalizedSource.toLowerCase() && item.line === line));
            session.breakpointResults.push(result);
            if (!wasPaused) {
                session.gdb.run('c');
                session.debug = { ...session.debug!, paused: false, sourcePath: undefined, line: undefined, message: 'Kernel running. Waiting for breakpoint.' };
            }
            return result;
        } catch (error) {
            if (!wasPaused && session.debug?.active) {
                try { session.gdb.run('c'); } catch { }
            }
            return { success: false, verified: false, sourcePath, line, message: error instanceof Error ? error.message : String(error) };
        } finally {
            session.internalPause = false;
        }
    }


    async updateBreakpoint(sessionId: string, request: InuBreakpointRequest): Promise<InuBreakpointResult> {
        const session = this.runSessions.get(sessionId);
        const sourcePath = path.resolve(request.sourcePath);
        const line = request.line;
        const condition = request.condition?.trim() || undefined;
        const hitCondition = request.hitCondition?.trim() || undefined;
        if (!session || session.mode !== 'debug' || !session.gdb || !session.debug?.active) {
            return { success: false, verified: false, sourcePath, line, condition, hitCondition, message: 'No active Inu debug session.' };
        }
        if (hitCondition && !this.isValidHitCondition(hitCondition)) {
            return { success: false, verified: false, sourcePath, line, condition, hitCondition, message: `Invalid hit-count expression "${hitCondition}". Use N, =N, >=N, >N, <=N, <N, or %N.` };
        }
        const key = `${sourcePath.toLowerCase()}:${line}`;
        const existing = session.breakpoints.get(key);
        if (!existing) {
            const result = await this.armSourceBreakpoint(session, { sourcePath, line, condition, hitCondition });
            session.breakpointResults = session.breakpointResults.filter(item => !(path.resolve(item.sourcePath).toLowerCase() === sourcePath.toLowerCase() && item.line === line));
            session.breakpointResults.push(result);
            return result;
        }
        existing.condition = condition;
        existing.hitCondition = hitCondition;
        existing.hitCount = 0;
        const result: InuBreakpointResult = {
            success: true,
            verified: true,
            sourcePath,
            line,
            resolvedLine: existing.resolvedLine,
            address: existing.address,
            condition,
            hitCondition,
            hitCount: 0,
            message: `Breakpoint options updated${condition ? `; condition: ${condition}` : ''}${hitCondition ? `; hit count: ${hitCondition}` : ''}. Hit counter reset.`
        };
        this.replaceBreakpointResult(session, result);
        return result;
    }

    async configureExceptionBreakpoints(sessionId: string, settings: InuExceptionBreakpointSettings): Promise<InuDebugState> {
        const session = this.runSessions.get(sessionId);
        if (!session || session.mode !== 'debug' || !session.gdb || !session.debug?.active) {
            return { active: false, paused: false, sourceSymbols: false, message: 'No active Inu debug session.' };
        }
        if (!session.debug.paused) {
            return { ...session.debug, message: 'Pause the kernel before changing CPU exception/panic breakpoints.' };
        }
        const vectors = Array.from(new Set((settings.vectors ?? []).filter(vector => Number.isInteger(vector) && vector >= 0 && vector < 32 && (vector !== 2 || settings.nmiOptIn === true))));
        for (const address of session.exceptionBreakpointAddresses.keys()) {
            try { await session.gdb.command(`z0,${address.toString(16)},1`); } catch { }
        }
        session.exceptionBreakpointAddresses.clear();
        if (session.panicBreakpointAddress) {
            try { await session.gdb.command(`z0,${session.panicBreakpointAddress.toString(16)},1`); } catch { }
            session.panicBreakpointAddress = undefined;
        }
        session.exceptionBreakpoints = { vectors, breakOnPanic: !!settings.breakOnPanic, nmiOptIn: settings.nmiOptIn === true };
        await this.armExceptionBreakpoints(session);
        session.debug = {
            ...session.debug,
            message: `Exception breakpoints updated: ${vectors.length} CPU vector(s)${settings.breakOnPanic ? ' + fatal/panic stop' : ''}.`
        };
        return session.debug;
    }

    async selectExecutionContext(sessionId: string, threadId: string): Promise<InuDebugState> {
        const session = this.runSessions.get(sessionId);
        if (!session || session.mode !== 'debug' || !session.gdb || !session.debug?.active) {
            return { active: false, paused: false, sourceSymbols: false, message: 'No active Inu debug session.' };
        }
        if (!session.debug.paused) {
            return { ...session.debug, message: 'Pause the kernel before switching CPU/thread context.' };
        }
        const normalized = threadId.trim();
        if (!normalized || !/^(?:p[0-9a-f]+\.)?[0-9a-f-]+$/i.test(normalized)) {
            return { ...session.debug, message: `Invalid GDB thread id "${threadId}".` };
        }
        const reply = await session.gdb.command(`Hg${normalized}`);
        if (reply !== 'OK') {
            return { ...session.debug, message: `QEMU rejected CPU/thread selection ${normalized}: ${reply}` };
        }
        session.selectedThreadId = normalized;
        const rip = await this.readRegister(session.gdb, 16);
        const source = this.resolveRuntimeSourceLocation(session, rip);
        session.debug = {
            ...session.debug,
            sourcePath: source?.sourcePath,
            line: source?.line,
            selectedThreadId: normalized,
            message: `Selected CPU/thread ${normalized}${source ? ` at ${path.basename(source.sourcePath)}:${source.line}` : ''}.`
        };
        await this.populatePausedDebugData(session, rip);
        return session.debug!;
    }

    async evaluateExpression(sessionId: string, expression: string): Promise<InuExpressionResult> {
        const session = this.runSessions.get(sessionId);
        const trimmed = expression.trim();
        if (!trimmed) { return { success: false, expression, error: 'Expression is empty.' }; }
        if (!session || session.mode !== 'debug' || !session.gdb || !session.debug?.active) {
            return { success: false, expression: trimmed, error: 'No active Inu debug session.' };
        }
        if (!session.debug.paused) {
            return { success: false, expression: trimmed, error: 'Watch expressions can be evaluated only while the kernel is paused.' };
        }
        try {
            const value = await this.evaluateExpressionValue(session, trimmed);
            const unsigned = BigInt.asUintN(64, value);
            return {
                success: true,
                expression: trimmed,
                value: value.toString(10),
                hexValue: `0x${unsigned.toString(16).padStart(16, '0')}`
            };
        } catch (error) {
            return { success: false, expression: trimmed, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async readMemoryRange(sessionId: string, addressExpression: string, length: number): Promise<InuMemoryReadResult> {
        const session = this.runSessions.get(sessionId);
        const expression = addressExpression.trim();
        const boundedLength = Math.max(1, Math.min(1024, Math.trunc(length || 0)));
        if (!expression) { return { success: false, expression, error: 'Memory address expression is empty.' }; }
        if (!session || session.mode !== 'debug' || !session.gdb || !session.debug?.active) {
            return { success: false, expression, error: 'No active Inu debug session.' };
        }
        if (!session.debug.paused) {
            return { success: false, expression, error: 'Memory can be inspected only while the kernel is paused.' };
        }
        try {
            const address = BigInt.asUintN(64, await this.evaluateExpressionValue(session, expression));
            const bytes = await this.readMemory(session.gdb, address, boundedLength);
            if (bytes.length !== boundedLength) {
                return { success: false, expression, address: `0x${address.toString(16)}`, error: `QEMU could not read ${boundedLength} byte(s) at 0x${address.toString(16)}.` };
            }
            return {
                success: true,
                expression,
                address: `0x${address.toString(16).padStart(16, '0')}`,
                length: bytes.length,
                bytes: bytes.toString('hex')
            };
        } catch (error) {
            return { success: false, expression, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async inspectPageTable(sessionId: string, addressExpression: string): Promise<InuPageTableInspection> {
        const session = this.runSessions.get(sessionId);
        const expression = addressExpression.trim();
        if (!expression) { return { success: false, expression, error: 'Virtual-address expression is empty.' }; }
        if (!session || session.mode !== 'debug' || !session.gdb || !session.debug?.active || !session.debug.paused) {
            return { success: false, expression, error: 'Page tables can be inspected only while a Inu kernel is paused.' };
        }
        try {
            const virtualAddress = BigInt.asUintN(64, await this.evaluateExpressionValue(session, expression));
            const monitorRegisters = await this.qemuMonitor(session.gdb, 'info registers');
            const cr3Match = /\bCR3\s*=\s*(?:0x)?([0-9a-fA-F]+)/i.exec(monitorRegisters);
            if (!cr3Match) {
                return { success: false, expression, virtualAddress: this.formatAddress(virtualAddress), error: 'QEMU did not expose CR3 through its monitor.' };
            }
            const cr3 = BigInt(`0x${cr3Match[1]}`) & 0x000ffffffffff000n;
            const indexes = [
                Number((virtualAddress >> 39n) & 0x1ffn),
                Number((virtualAddress >> 30n) & 0x1ffn),
                Number((virtualAddress >> 21n) & 0x1ffn),
                Number((virtualAddress >> 12n) & 0x1ffn)
            ];
            const levels: Array<'PML4' | 'PDPT' | 'PD' | 'PT'> = ['PML4', 'PDPT', 'PD', 'PT'];
            const entries: InuPageTableEntry[] = [];
            let table = cr3;
            let physicalAddress: bigint | undefined;
            let pageSize = '';
            for (let depth = 0; depth < 4; depth++) {
                const index = indexes[depth];
                const entryPhysicalAddress = table + BigInt(index * 8);
                const value = await this.readPhysicalU64(session.gdb, entryPhysicalAddress);
                const present = (value & 1n) !== 0n;
                const largePage = depth >= 1 && depth <= 2 && (value & (1n << 7n)) !== 0n;
                let target: bigint | undefined;
                if (present) {
                    if (depth === 1 && largePage) target = value & 0x000fffffc0000000n;
                    else if (depth === 2 && largePage) target = value & 0x000fffffffe00000n;
                    else target = value & 0x000ffffffffff000n;
                }
                entries.push({
                    level: levels[depth], index,
                    entryPhysicalAddress: this.formatAddress(entryPhysicalAddress),
                    entryValue: this.formatAddress(value),
                    present,
                    writable: (value & (1n << 1n)) !== 0n,
                    user: (value & (1n << 2n)) !== 0n,
                    writeThrough: (value & (1n << 3n)) !== 0n,
                    cacheDisable: (value & (1n << 4n)) !== 0n,
                    accessed: (value & (1n << 5n)) !== 0n,
                    dirty: depth === 3 || largePage ? (value & (1n << 6n)) !== 0n : false,
                    largePage,
                    global: depth === 3 || largePage ? (value & (1n << 8n)) !== 0n : false,
                    noExecute: (value & (1n << 63n)) !== 0n,
                    targetPhysicalAddress: target !== undefined ? this.formatAddress(target) : undefined
                });
                if (!present || target === undefined) { break; }
                if (depth === 1 && largePage) {
                    physicalAddress = target + (virtualAddress & ((1n << 30n) - 1n));
                    pageSize = '1 GiB';
                    break;
                }
                if (depth === 2 && largePage) {
                    physicalAddress = target + (virtualAddress & ((1n << 21n) - 1n));
                    pageSize = '2 MiB';
                    break;
                }
                if (depth === 3) {
                    physicalAddress = target + (virtualAddress & 0xfffn);
                    pageSize = '4 KiB';
                    break;
                }
                table = target;
            }
            return {
                success: physicalAddress !== undefined,
                expression,
                virtualAddress: this.formatAddress(virtualAddress),
                cr3: this.formatAddress(cr3),
                pageSize: physicalAddress !== undefined ? pageSize : undefined,
                physicalAddress: physicalAddress !== undefined ? this.formatAddress(physicalAddress) : undefined,
                entries,
                error: physicalAddress === undefined ? 'The virtual address is not present in the active x64 page tables.' : undefined
            };
        } catch (error) {
            return { success: false, expression, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async inspectHeap(sessionId: string): Promise<InuHeapSnapshot> {
        const session = this.runSessions.get(sessionId);
        if (!session || session.mode !== 'debug' || !session.gdb || !session.debug?.active || !session.debug.paused) {
            return { success: false, error: 'Kernel heap state can be inspected only while a Inu kernel is paused.' };
        }
        try {
            // Inu KernelHeap ABI v1 keeps its live allocator metadata in a fixed debugger-readable
            // virtual region at the top of the kernel-heap reservation. This is authoritative and does
            // not depend on private NativeAOT static-field names surviving PDB/link-map generation.
            const diagnosticAddress = 0xFFFF81FFFFFFC000n;
            const diagnosticHeader = await this.readMemoryChunked(session.gdb, diagnosticAddress, 64, 64);
            const diagnosticMagic = 0x4E4F484541503031n;
            let stateAddress: bigint;
            let stateBytes: Buffer;
            let diagnosticCommitted: bigint | undefined;
            let diagnosticAllocated: bigint | undefined;
            let diagnosticPeak: bigint | undefined;
            let diagnosticLive: number | undefined;
            let diagnosticInitialized: boolean | undefined;
            let diagnosticAbi = false;
            if (diagnosticHeader.length === 64 && diagnosticHeader.readBigUInt64LE(0) === diagnosticMagic && diagnosticHeader.readUInt32LE(8) === 1 && diagnosticHeader.readUInt32LE(12) === 512) {
                diagnosticAbi = true;
                diagnosticCommitted = diagnosticHeader.readBigUInt64LE(16);
                diagnosticAllocated = diagnosticHeader.readBigUInt64LE(24);
                diagnosticPeak = diagnosticHeader.readBigUInt64LE(32);
                diagnosticLive = diagnosticHeader.readUInt32LE(48);
                diagnosticInitialized = diagnosticHeader[56] !== 0;
                stateAddress = diagnosticAddress + 64n;
                stateBytes = await this.readMemoryChunked(session.gdb, stateAddress, 12800, 512);
            } else {
                // Backward compatibility for kernels built before the stable heap diagnostic ABI.
                await this.ensureNativeGlobalSymbols(session);
                const stateSymbol = this.findHeapGlobal(session, '_state');
                if (!stateSymbol || session.relocationDelta === undefined) {
                    return { success: false, error: 'This kernel predates the stable KernelHeap diagnostic ABI and NativeAOT did not expose its private _state symbol. Rebuild the OS with the bundled Inu SDK from IDE 0.11.5 or later.' };
                }
                stateAddress = stateSymbol.linkedAddress + session.relocationDelta;
                stateBytes = await this.readMemoryChunked(session.gdb, stateAddress, 12800, 512);
            }
            if (stateBytes.length !== 12800) {
                return { success: false, error: `Could not read the KernelHeap state table at ${this.formatAddress(stateAddress)}.` };
            }
            const blocks: InuHeapBlock[] = [];
            let allocatedDerived = 0n;
            let freeDerived = 0n;
            let liveDerived = 0;
            let freeBlocksDerived = 0;
            for (let index = 0; index < 512; index++) {
                const start = stateBytes.readBigUInt64LE(index * 8);
                const length = stateBytes.readBigUInt64LE(4096 + index * 8);
                const token = stateBytes.readBigUInt64LE(8192 + index * 8);
                const state = stateBytes[12288 + index];
                if ((state !== 1 && state !== 2) || length === 0n) { continue; }
                if (state === 2) { allocatedDerived += length; liveDerived++; }
                else { freeDerived += length; freeBlocksDerived++; }
                blocks.push({
                    index,
                    state: state === 2 ? 'allocated' : 'free',
                    address: this.formatAddress(start),
                    byteCount: this.safeNumber(length),
                    token: state === 2 ? `0x${token.toString(16)}` : undefined
                });
            }
            const readGlobalU64 = async (suffix: string): Promise<bigint | undefined> => {
                const symbol = this.findHeapGlobal(session, suffix);
                if (!symbol) return undefined;
                return this.readU64(session.gdb!, symbol.linkedAddress + session.relocationDelta!);
            };
            const readGlobalU32 = async (suffix: string): Promise<number | undefined> => {
                const symbol = this.findHeapGlobal(session, suffix);
                if (!symbol) return undefined;
                const bytes = await this.readMemory(session.gdb!, symbol.linkedAddress + session.relocationDelta!, 4);
                return bytes.length === 4 ? bytes.readUInt32LE(0) : undefined;
            };
            let committed = diagnosticCommitted;
            let allocated = diagnosticAllocated;
            let peak = diagnosticPeak;
            let live = diagnosticLive;
            let initialized = diagnosticInitialized;
            if (!diagnosticAbi) {
                committed = await readGlobalU64('_committed');
                allocated = await readGlobalU64('_allocated');
                peak = await readGlobalU64('_peak');
                live = await readGlobalU32('_live');
                const initializedSymbol = this.findHeapGlobal(session, '_initialized');
                if (initializedSymbol) {
                    const byte = await this.readMemory(session.gdb, initializedSymbol.linkedAddress + session.relocationDelta!, 1);
                    if (byte.length === 1) initialized = byte[0] !== 0;
                }
            }
            return {
                success: true,
                initialized: initialized ?? blocks.length > 0,
                committedBytes: this.safeNumber(committed ?? (allocatedDerived + freeDerived)),
                allocatedBytes: this.safeNumber(allocated ?? allocatedDerived),
                freeBytes: this.safeNumber(freeDerived),
                peakAllocatedBytes: this.safeNumber(peak ?? allocatedDerived),
                liveAllocations: live ?? liveDerived,
                freeBlocks: freeBlocksDerived,
                blocks,
                message: diagnosticAbi
                    ? `KernelHeap metadata read from Inu heap diagnostic ABI v1 (${blocks.length} active/free block record(s)).`
                    : `KernelHeap metadata read from legacy NativeAOT globals (${blocks.length} active/free block record(s)).`
            };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async captureCrashDump(sessionId: string, reason = 'manual debugger capture'): Promise<InuCrashDumpResult> {
        const session = this.runSessions.get(sessionId);
        if (!session || session.mode !== 'debug' || !session.gdb || !session.debug?.active || !session.debug.paused) {
            return { success: false, error: 'A crash/debug dump can be captured only while the Inu kernel is paused.' };
        }

        try {
            const registers = session.debug.registers ?? [];
            const register = (name: string): string | undefined => registers.find(item => item.name.toLowerCase() === name)?.value;
            const debuggerRip = register('rip') ?? 'rip';
            const faultRip = session.debug.faultInstructionPointer ?? debuggerRip;
            const rsp = register('rsp') ?? 'rsp';
            const pageTable = await this.inspectPageTable(sessionId, faultRip);
            const heap = await this.inspectHeap(sessionId);
            const stackMemory = await this.readMemoryRange(sessionId, rsp, 512);
            const codeMemory = await this.readMemoryRange(sessionId, faultRip, 128);
            const configurationResult = await this.readProjectConfiguration(session.projectRoot);
            const configuration = configurationResult.success ? configurationResult.configuration : undefined;
            const contexts = session.debug.executionContexts ?? [];

            const processMap = new Map<string, InuCrashDumpProcess>();
            for (const context of contexts) {
                const processId = context.processId ?? '0';
                const existing = processMap.get(processId) ?? {
                    processId,
                    name: processId === '0' ? 'kernel' : `process ${processId}`,
                    current: false,
                    threadIds: [],
                    cpuIndexes: []
                };
                existing.current = existing.current || context.current;
                if (!existing.threadIds.includes(context.threadId)) existing.threadIds.push(context.threadId);
                if (context.cpuIndex !== undefined && !existing.cpuIndexes.includes(context.cpuIndex)) existing.cpuIndexes.push(context.cpuIndex);
                processMap.set(processId, existing);
            }

            const modules: InuCrashDumpModule[] = [];
            if (session.nativeDebugMap?.image || session.nativeDebugMap?.pdb) {
                modules.push({
                    name: path.basename(session.nativeDebugMap.image ?? 'Inu kernel'),
                    imagePath: session.nativeDebugMap.image,
                    pdbPath: session.nativeDebugMap.pdb,
                    runtimeBase: session.relocationDelta !== undefined ? `0x${session.relocationDelta.toString(16)}` : undefined,
                    relocationDelta: session.relocationDelta !== undefined ? `0x${session.relocationDelta.toString(16)}` : undefined,
                    sourceEntryCount: session.nativeDebugMap.entries.length
                });
            }

            const configuredDrivers = Array.from(new Set([
                ...(configuration?.drivers ?? []),
                ...(configuration?.storageControllers ?? []),
                ...(configuration?.networkDrivers ?? []),
                ...(configuration?.input ?? []),
                ...(configuration?.graphics ?? [])
            ]));
            const drivers: InuCrashDumpDriverState[] = configuredDrivers.map(id => ({
                id,
                configured: true,
                state: 'configured',
                detail: 'Configured by Inu.json. Live lifecycle state was not exported by this paused kernel.'
            }));

            const selectedContext = contexts.find(item => item.current) ?? contexts.find(item => item.threadId === session.debug?.selectedThreadId);
            const architecture = configuration?.targetArchitecture ?? 'x86_64';
            const createdUtc = new Date().toISOString();
            const panic: InuCrashDumpPanic = {
                reason,
                exceptionVector: session.debug.exceptionVector,
                exceptionName: session.debug.exceptionName,
                faultInstructionPointer: session.debug.faultInstructionPointer,
                sourcePath: session.debug.sourcePath,
                line: session.debug.line,
                message: session.debug.message
            };

            const document: InuCrashDumpDocument = {
                magic: 'NOCD',
                format: 'Inu Crash Dump',
                formatVersion: { major: 1, minor: 1 },
                architecture,
                createdUtc,
                producer: { product: 'Kath', version: KATH_VERSION },
                project: { name: configuration?.name, root: session.projectRoot },
                sections: {
                    cpuState: {
                        version: 1,
                        available: true,
                        data: {
                            architecture,
                            cpuIndex: selectedContext?.cpuIndex,
                            threadId: selectedContext?.threadId ?? session.debug.selectedThreadId,
                            processId: selectedContext?.processId,
                            instructionPointer: faultRip,
                            stackPointer: register('rsp'),
                            framePointer: register('rbp'),
                            flags: register('rflags') ?? register('eflags'),
                            pageTableRoot: register('cr3') ?? pageTable.cr3,
                            executionContexts: contexts
                        }
                    },
                    registers: { version: 1, available: registers.length > 0, data: registers },
                    stack: {
                        version: 1,
                        available: (session.debug.callStack?.length ?? 0) > 0 || stackMemory.success,
                        data: { frames: session.debug.callStack ?? [], memory: stackMemory }
                    },
                    pageTables: { version: 1, available: pageTable.success, data: pageTable, note: pageTable.error },
                    processes: {
                        version: 1,
                        available: processMap.size > 0,
                        data: Array.from(processMap.values()),
                        note: processMap.size > 0 ? undefined : 'No process/thread execution-context ABI was available.'
                    },
                    modules: {
                        version: 1,
                        available: modules.length > 0,
                        data: modules,
                        note: modules.length > 0 ? undefined : 'No native debug image metadata was available.'
                    },
                    heap: { version: 1, available: heap.success, data: heap, note: heap.error },
                    memoryRanges: {
                        version: 1,
                        available: stackMemory.success || codeMemory.success,
                        data: { stack: stackMemory, code: codeMemory }
                    },
                    panic: { version: 1, available: true, data: panic },
                    drivers: {
                        version: 1,
                        available: drivers.length > 0,
                        data: drivers,
                        note: drivers.length > 0
                            ? 'Driver configuration captured; live lifecycle state is marked configured until the runtime driver-state ABI is available.'
                            : 'No configured drivers were found.'
                    },
                    telemetry: {
                        version: 1,
                        available: session.output.length > 0,
                        data: { serialTail: session.output.slice(-65536) },
                        note: session.output.length > 0
                            ? 'Recent Kath/runtime output captured at crash time; bounded to the final 64 KiB.'
                            : 'No recent telemetry/output was available.'
                    }
                }
            };

            const dumpRoot = path.join(session.projectRoot, '.inu', 'crash-dumps');
            await fs.mkdir(dumpRoot, { recursive: true });
            const stamp = createdUtc.replace(/[:.]/g, '-');
            const dumpPath = path.join(dumpRoot, `Inu-${stamp}.nodump.json`);
            await fs.writeFile(dumpPath, JSON.stringify(document, null, 2), 'utf8');

            const dump: InuCrashDumpSummary = {
                path: dumpPath,
                createdUtc,
                reason,
                formatVersion: '1.1',
                sourcePath: session.debug.sourcePath,
                line: session.debug.line
            };
            session.output += `[ OK ] Inu Crash Dump v1.1 captured: ${dumpPath}\r\n`;
            return {
                success: true,
                dump,
                document,
                state: { ...session.debug },
                pageTable,
                heap,
                memory: { stack: stackMemory, code: codeMemory }
            };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async listCrashDumps(projectPath: string): Promise<InuCrashDumpSummary[]> {
        const projectRoot = path.resolve(projectPath);
        const dumpRoot = path.join(projectRoot, '.inu', 'crash-dumps');
        try {
            const names = (await fs.readdir(dumpRoot)).filter(name => name.endsWith('.nodump.json')).sort().reverse();
            const result: InuCrashDumpSummary[] = [];
            for (const name of names.slice(0, 100)) {
                try {
                    const file = path.join(dumpRoot, name);
                    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as any;
                    if (parsed.magic === 'NOCD' && parsed.formatVersion?.major === 1) {
                        const panic = parsed.sections?.panic?.data;
                        result.push({
                            path: file,
                            createdUtc: String(parsed.createdUtc ?? ''),
                            reason: String(panic?.reason ?? 'crash/debug dump'),
                            formatVersion: `${parsed.formatVersion.major}.${parsed.formatVersion.minor ?? 0}`,
                            sourcePath: panic?.sourcePath,
                            line: panic?.line
                        });
                    } else if (parsed.schemaVersion === 1) {
                        result.push({
                            path: file,
                            createdUtc: String(parsed.createdUtc ?? ''),
                            reason: String(parsed.reason ?? 'legacy crash/debug dump'),
                            formatVersion: 'legacy-1',
                            legacy: true,
                            sourcePath: parsed.debugState?.sourcePath,
                            line: parsed.debugState?.line
                        });
                    }
                } catch { }
            }
            return result;
        } catch { return []; }
    }

    async loadCrashDump(dumpPath: string): Promise<InuCrashDumpResult> {
        try {
            const resolved = path.resolve(dumpPath);
            if (!resolved.toLowerCase().endsWith('.nodump.json')) {
                return { success: false, error: 'Inu crash dumps must use the .nodump.json format.' };
            }
            const parsed = JSON.parse(await fs.readFile(resolved, 'utf8')) as any;

            // Formal Inu Crash Dump v1.x. Major 1 is the compatibility boundary.
            if (parsed.magic === 'NOCD' && parsed.format === 'Inu Crash Dump') {
                const major = Number(parsed.formatVersion?.major);
                const minor = Number(parsed.formatVersion?.minor ?? 0);
                if (major !== 1) {
                    return { success: false, error: `Inu Crash Dump major version ${major} is not supported by this IDE. Supported major version: 1.` };
                }
                if (!parsed.sections || typeof parsed.sections !== 'object') {
                    return { success: false, error: 'The Inu Crash Dump does not contain a section directory.' };
                }

                // Minor releases and section versions are forward-compatible: unknown fields
                // or sections are intentionally ignored. Known v1 sections are projected into
                // the existing debugger views so old and new IDE tooling can share one model.
                const panic = parsed.sections.panic?.data ?? {};
                const cpu = parsed.sections.cpuState?.data ?? {};
                const registers = Array.isArray(parsed.sections.registers?.data) ? parsed.sections.registers.data : [];
                const stack = parsed.sections.stack?.data ?? {};
                const state: InuDebugState = {
                    active: true,
                    paused: true,
                    sourceSymbols: true,
                    sourcePath: panic.sourcePath,
                    line: panic.line,
                    message: `Offline Inu Crash Dump v${major}.${minor}: ${panic.reason ?? 'captured kernel state'}`,
                    registers,
                    callStack: Array.isArray(stack.frames) ? stack.frames : [],
                    executionContexts: Array.isArray(cpu.executionContexts) ? cpu.executionContexts : [],
                    selectedThreadId: cpu.threadId,
                    exceptionVector: panic.exceptionVector,
                    exceptionName: panic.exceptionName
                };
                const pageTable = parsed.sections.pageTables?.data;
                const heap = parsed.sections.heap?.data;
                const memory = parsed.sections.memoryRanges?.data;
                const dump: InuCrashDumpSummary = {
                    path: resolved,
                    createdUtc: String(parsed.createdUtc ?? ''),
                    reason: String(panic.reason ?? 'crash/debug dump'),
                    formatVersion: `${major}.${minor}`,
                    sourcePath: state.sourcePath,
                    line: state.line
                };
                return { success: true, dump, document: parsed as InuCrashDumpDocument, state, pageTable, heap, memory };
            }

            // Pre-0.11.5 IDE dumps are retained as a documented legacy import path.
            if (parsed.schemaVersion === 1 && parsed.debugState) {
                const state: InuDebugState = {
                    ...parsed.debugState,
                    active: true,
                    paused: true,
                    message: `Offline legacy crash dump: ${parsed.reason ?? 'captured debugger state'}`
                };
                const dump: InuCrashDumpSummary = {
                    path: resolved,
                    createdUtc: String(parsed.createdUtc ?? ''),
                    reason: String(parsed.reason ?? 'legacy crash/debug dump'),
                    formatVersion: 'legacy-1',
                    legacy: true,
                    sourcePath: state.sourcePath,
                    line: state.line
                };
                return { success: true, dump, state, pageTable: parsed.pageTable, heap: parsed.heap, memory: parsed.memory };
            }

            return { success: false, error: 'The file is not a supported Inu Crash Dump.' };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }


    protected async refreshAuthoritativeRuntimeConfiguration(projectRoot: string): Promise<void> {
        const configurationPath = path.join(projectRoot, 'Inu.json');
        const parsedConfiguration = JSON.parse(await fs.readFile(configurationPath, 'utf8')) as InuProjectConfiguration;
        if (!(parsedConfiguration.location || '').trim()) parsedConfiguration.location = path.dirname(projectRoot);
        const migration = this.migrateLegacyCpuRoleDefaults(parsedConfiguration);
        const configuration = migration.configuration;
        const validationError = this.validate(configuration);
        if (validationError) throw new Error(`Existing Inu.json is invalid: ${validationError}`);
        const authoritativeConfiguration: InuProjectConfiguration = {
            ...this.copyConfiguration(configuration),
            name: configuration.name,
            location: path.dirname(projectRoot)
        };
        if (migration.migrated) {
            await fs.writeFile(configurationPath, this.configurationJson(authoritativeConfiguration), 'utf8');
        }
        await fs.mkdir(path.join(projectRoot, 'Kernel', 'Provided', 'Configuration'), { recursive: true });
        await fs.writeFile(path.join(projectRoot, 'Kernel', 'Provided', 'Configuration', 'GeneratedConfiguration.cs'), this.generatedConfigurationSource(authoritativeConfiguration), 'utf8');
        await fs.mkdir(path.join(projectRoot, 'Kernel', 'Provided', 'Core'), { recursive: true });
        await fs.writeFile(path.join(projectRoot, 'Kernel', 'Provided', 'Core', 'KernelRuntime.cs'), this.kernelSource(authoritativeConfiguration), 'utf8');
        await this.materializeCoderOwnedSource(projectRoot, authoritativeConfiguration);
    }

    async readProjectConfiguration(projectPath: string): Promise<InuConfigurationResult> {
        try {
            const projectRoot = this.requireOperatingSystemRoot(projectPath);
            const configurationPath = path.join(projectRoot, 'Inu.json');
            const parsedConfiguration = JSON.parse(await fs.readFile(configurationPath, 'utf8')) as InuProjectConfiguration;
            if (!(parsedConfiguration.location || '').trim()) parsedConfiguration.location = path.dirname(projectRoot);
            const configuration = this.migrateLegacyCpuRoleDefaults(parsedConfiguration).configuration;
            const validationError = this.validate(configuration);
            if (validationError) {
                return { success: false, error: `Existing Inu.json is invalid: ${validationError}` };
            }
            return { success: true, projectPath: projectRoot, configuration: this.copyConfiguration(configuration) };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message };
        }
    }

    async reconfigureProject(projectPath: string, configuration: InuProjectConfiguration): Promise<InuProjectResult> {
        this.projectGenerationPercent = 0;
        try {
            const projectRoot = this.requireOperatingSystemRoot(projectPath);
            const existingConfiguration = JSON.parse(await fs.readFile(path.join(projectRoot, 'Inu.json'), 'utf8')) as InuProjectConfiguration;
            const existingName = existingConfiguration.name || path.basename(projectRoot);
            if (configuration.name.toLowerCase() !== existingName.toLowerCase()) {
                return { success: false, error: 'The operating-system name cannot be changed while reconfiguring. Create a new OS to use a different name.' };
            }

            const authoritativeConfiguration: InuProjectConfiguration = {
                ...this.copyConfiguration(configuration),
                name: existingName,
                location: path.dirname(projectRoot)
            };
            const validationError = this.validate(authoritativeConfiguration);
            if (validationError) return { success: false, error: validationError };

            await fs.access(path.join(projectRoot, 'Inu.json'));
            const previousProjects = await this.readGeneratedProjectGraph(projectRoot);
            const generatedProjects = this.buildProjectGraph(authoritativeConfiguration);
            const totalSteps = generatedProjects.length + 18;
            let completedSteps = 0;
            const advance = () => { completedSteps++; this.projectGenerationPercent = Math.min(99, Math.floor((completedSteps * 100) / totalSteps)); };

            await this.removeObsoleteGeneratedProjects(projectRoot, previousProjects, generatedProjects, authoritativeConfiguration.name); advance();
            await this.createBaseDirectories(projectRoot, authoritativeConfiguration); advance();
            await fs.rm(path.join(projectRoot, 'Inu.slnx'), { force: true });
            for (const project of generatedProjects) { await this.writeGeneratedProject(projectRoot, authoritativeConfiguration, project); advance(); }

                        await fs.writeFile(path.join(projectRoot, 'Inu.json'), this.configurationJson(authoritativeConfiguration), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'Inu.Configuration.json'), this.sdkConfigurationJson(authoritativeConfiguration), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'Inu.Configuration.props'), this.sdkConfigurationProps(authoritativeConfiguration), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'Inu.Configuration.targets'), this.sdkConfigurationTargets(authoritativeConfiguration), 'utf8'); advance();
            const managedKernelProjectTemplate = path.join(INU_SDK_ROOT, 'templates', 'InuKernel', 'InuKernel.csproj');
            await fs.copyFile(managedKernelProjectTemplate, path.join(projectRoot, 'InuKernel.csproj')); advance();
            await this.materializeSelectedManagedSdkSource(projectRoot, authoritativeConfiguration); advance();
            await this.materializeSelectedUserlandSource(projectRoot, authoritativeConfiguration);
            await this.removeUnusedOptionalRoots(projectRoot);
            await fs.writeFile(path.join(projectRoot, 'Inu.ProjectGraph.json'), this.projectGraphJson(authoritativeConfiguration, generatedProjects), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'InuProject.json'), this.sdkProjectManifest(authoritativeConfiguration), 'utf8'); advance();
            await fs.mkdir(path.join(projectRoot, 'Kernel', 'Provided', 'Configuration'), { recursive: true }); advance();
            await fs.writeFile(path.join(projectRoot, 'Kernel', 'Provided', 'Configuration', 'GeneratedConfiguration.cs'), this.generatedConfigurationSource(authoritativeConfiguration), 'utf8'); advance();
            await fs.mkdir(path.join(projectRoot, 'Kernel', 'Provided', 'Core'), { recursive: true }); advance();
            await fs.writeFile(path.join(projectRoot, 'Kernel', 'Provided', 'Core', 'KernelRuntime.cs'), this.kernelSource(authoritativeConfiguration), 'utf8'); advance();
            await this.materializeCoderOwnedSource(projectRoot, authoritativeConfiguration); advance();
            await fs.writeFile(path.join(projectRoot, 'Build.bat'), this.buildBatch(), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'Run.bat'), this.runBatch(authoritativeConfiguration), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'README.md'), this.projectReadme(authoritativeConfiguration, generatedProjects), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'PUBLIC-SDK-USAGE.md'), this.publicSdkUsageGuide(authoritativeConfiguration), 'utf8'); advance();
            await this.syncConfiguredQemuCpuCount(projectRoot, authoritativeConfiguration); advance();
            this.projectGenerationPercent = 100;
            return { success: true, projectPath: projectRoot, generatedProjects: generatedProjects.map(project => project.id) };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message };
        }
    }

    async createProject(configuration: InuProjectConfiguration): Promise<InuProjectResult> {
        this.projectGenerationPercent = 0;
        try {
            const validationError = this.validate(configuration);
            if (validationError) return { success: false, error: validationError };

            const location = this.osRegistry.resolveLocation(configuration.location);
            const authoritativeConfiguration: InuProjectConfiguration = { ...this.copyConfiguration(configuration), location };
            const allocation = await this.osRegistry.allocateProjectDirectory(authoritativeConfiguration.name, location);
            const projectRoot = allocation.projectRoot;
            // The concrete allocated instance name is authoritative everywhere.
            // If MyOs1 already exists and the registry allocates MyOs1-10, the
            // generated manifests, source tree and running OS must also say MyOs1-10.
            authoritativeConfiguration.name = allocation.name;
            const generatedProjects = this.buildProjectGraph(authoritativeConfiguration);
            const totalSteps = generatedProjects.length + 19;
            let completedSteps = 0;
            const advance = () => { completedSteps++; this.projectGenerationPercent = Math.min(99, Math.floor((completedSteps * 100) / totalSteps)); };

            await this.createBaseDirectories(projectRoot, authoritativeConfiguration); advance();
            await fs.rm(path.join(projectRoot, 'Inu.slnx'), { force: true });
            for (const project of generatedProjects) { await this.writeGeneratedProject(projectRoot, authoritativeConfiguration, project); advance(); }

                        await fs.writeFile(path.join(projectRoot, 'Inu.json'), this.configurationJson(authoritativeConfiguration), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'Inu.Configuration.json'), this.sdkConfigurationJson(authoritativeConfiguration), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'Inu.Configuration.props'), this.sdkConfigurationProps(authoritativeConfiguration), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'Inu.Configuration.targets'), this.sdkConfigurationTargets(authoritativeConfiguration), 'utf8'); advance();
            const managedKernelProjectTemplate = path.join(INU_SDK_ROOT, 'templates', 'InuKernel', 'InuKernel.csproj');
            await fs.copyFile(managedKernelProjectTemplate, path.join(projectRoot, 'InuKernel.csproj')); advance();
            await this.materializeSelectedManagedSdkSource(projectRoot, authoritativeConfiguration); advance();
            await this.materializeSelectedUserlandSource(projectRoot, authoritativeConfiguration);
            await this.removeUnusedOptionalRoots(projectRoot);
            await fs.writeFile(path.join(projectRoot, 'Inu.ProjectGraph.json'), this.projectGraphJson(authoritativeConfiguration, generatedProjects), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'InuProject.json'), this.sdkProjectManifest(authoritativeConfiguration), 'utf8'); advance();
            await fs.mkdir(path.join(projectRoot, 'Kernel', 'Provided', 'Configuration'), { recursive: true }); advance();
            await fs.writeFile(path.join(projectRoot, 'Kernel', 'Provided', 'Configuration', 'GeneratedConfiguration.cs'), this.generatedConfigurationSource(authoritativeConfiguration), 'utf8'); advance();
            await fs.mkdir(path.join(projectRoot, 'Kernel', 'Provided', 'Core'), { recursive: true }); advance();
            await fs.writeFile(path.join(projectRoot, 'Kernel', 'Provided', 'Core', 'KernelRuntime.cs'), this.kernelSource(authoritativeConfiguration), 'utf8'); advance();
            await this.materializeCoderOwnedSource(projectRoot, authoritativeConfiguration); advance();
            await fs.writeFile(path.join(projectRoot, 'Build.bat'), this.buildBatch(), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'Run.bat'), this.runBatch(authoritativeConfiguration), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'README.md'), this.projectReadme(authoritativeConfiguration, generatedProjects), 'utf8'); advance();
            await fs.writeFile(path.join(projectRoot, 'PUBLIC-SDK-USAGE.md'), this.publicSdkUsageGuide(authoritativeConfiguration), 'utf8'); advance();
            await this.syncConfiguredQemuCpuCount(projectRoot, authoritativeConfiguration); advance();
            await this.osRegistry.registerProject(projectRoot); advance();
            this.projectGenerationPercent = 100;
            return { success: true, projectPath: projectRoot, generatedProjects: generatedProjects.map(project => project.id) };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message };
        }
    }

    protected requireOperatingSystemRoot(projectPath: string): string {
        const projectRoot = path.resolve((projectPath ?? '').trim());
        if (!projectPath || projectRoot === path.parse(projectRoot).root) throw new Error('A specific Inu OS project folder is required.');
        if (projectRoot.toLowerCase() === path.resolve(KATH_ROOT).toLowerCase() || projectRoot.toLowerCase() === path.resolve(INU_SDK_ROOT).toLowerCase()) {
            throw new Error('The Kath or SDK installation directory cannot be used as an OS project root.');
        }
        return projectRoot;
    }

    protected latestSessionForProject(projectPath: string): RunSession | undefined {
        const root = path.resolve(projectPath);
        return Array.from(this.runSessions.values()).filter(item => item.projectRoot === root).sort((a, b) => b.startedAtMs - a.startedAtMs)[0];
    }

    protected elapsedMs(session: RunSession): number { return Math.max(0, Date.now() - session.startedAtMs); }

    protected ingestTelemetry(session: RunSession, text: string): void {
        session.telemetryBuffer += text.replace(/\r/g, '');
        const lines = session.telemetryBuffer.split('\n');
        session.telemetryBuffer = lines.pop() ?? '';
        for (const raw of lines) {
            const line = raw.trim(); if (!line) continue;
            const now = this.elapsedMs(session);
            if (this.ingestStructuredTelemetry(session, line, now)) { session.structuredTelemetrySeen = true; continue; }
            if (!session.structuredTelemetrySeen) this.ingestBootMilestone(session, line, now);
        }
    }

    protected ingestStructuredTelemetry(session: RunSession, line: string, now: number): boolean {
        const match = /^\[INU:(TRACE|BOOT|PROFILE|COUNTER|DIAGNOSTIC)\]\s*(.*)$/i.exec(line); if (!match) return false;
        const kind = match[1].toUpperCase(); const values = this.parseTelemetryFields(match[2]);
        const timestamp = values['timestamp_ns'] !== undefined ? Number(values['timestamp_ns']) / 1_000_000 : Number(values['ms'] ?? values['timestamp_ms'] ?? now); const cpu = values['cpu'] !== undefined ? Number(values['cpu']) : undefined;
        if (kind === 'BOOT') {
            const name = values['stage'] ?? values['name'] ?? 'Boot'; const phase = (values['phase'] ?? 'end').toLowerCase();
            if (phase === 'begin') this.beginBootStage(session, name, Number.isFinite(timestamp) ? timestamp : now, values['details']);
            else { const phaseStatus = phase === 'failed' ? 'failed' : phase === 'warning' ? 'warning' : 'complete'; this.endBootStage(session, name, Number.isFinite(timestamp) ? timestamp : now, (values['status'] as InuBootStage['status']) || phaseStatus, values['details']); }
            return true;
        }
        if (kind === 'TRACE') {
            this.pushTraceEvent(session, { id: 0, timestampMs: Number.isFinite(timestamp) ? timestamp : now, category: this.traceCategory(values['category']), name: values['name'] ?? values['event'] ?? 'event', phase: this.tracePhase(values['phase']), cpuIndex: Number.isFinite(cpu) ? cpu : undefined, durationMs: this.numberField(values, 'duration_ms') ?? (this.numberField(values, 'duration_ns') !== undefined ? this.numberField(values, 'duration_ns')! / 1_000_000 : undefined), details: values['details'] });
            return true;
        }
        if (kind === 'COUNTER') {
            const name = values['name'] ?? 'counter'; const category = values['category'] ?? 'kernel'; const value = this.numberField(values, 'value') ?? 0;
            const counter = session.profileCounters.get(name) ?? { category, count: 0, totalDurationMs: 0 }; counter.category = category; counter.count = value; session.profileCounters.set(name, counter);
            this.pushTraceEvent(session, { id: 0, timestampMs: Number.isFinite(timestamp) ? timestamp : now, category: this.traceCategory(category), name, phase: 'instant', cpuIndex: Number.isFinite(cpu) ? cpu : undefined, details: `counter=${value}` });
            return true;
        }
        if (kind === 'DIAGNOSTIC') {
            const code = this.numberField(values, 'code') ?? 0; const details = values['details'] ? `${values['details']} (code ${code})` : `diagnostic code ${code}`;
            this.pushTraceEvent(session, { id: 0, timestampMs: Number.isFinite(timestamp) ? timestamp : now, category: 'diagnostic', name: values['name'] ?? 'diagnostic', phase: 'instant', cpuIndex: Number.isFinite(cpu) ? cpu : undefined, details, severity: code === 0 ? 'info' : 'warning' });
            return true;
        }
        const subtype = (values['kind'] ?? values['type'] ?? 'sample').toLowerCase();
        if (subtype === 'sample') {
            const name = values['function'] ?? values['name'] ?? values['symbol'] ?? 'unknown'; const category = values['category'] ?? 'cpu'; const duration = this.numberField(values, 'duration_ms') ?? ((this.numberField(values, 'duration_ns') ?? 0) / 1_000_000); const emittedSamples = Math.max(1, this.numberField(values, 'samples') ?? 1);
            const item = session.profileSamples.get(name) ?? { samples: 0, totalDurationMs: 0, category }; item.samples += emittedSamples; item.totalDurationMs += duration; session.profileSamples.set(name, item);
            if (Number.isFinite(cpu)) { const c = session.profileCpuSamples.get(cpu!) ?? { samples: 0, busySamples: 0 }; c.samples++; c.busySamples += values['idle'] === '1' || values['idle'] === 'true' ? 0 : 1; session.profileCpuSamples.set(cpu!, c); }
        } else {
            const name = values['name'] ?? subtype; const category = values['category'] ?? subtype; const delta = this.numberField(values, 'delta') ?? 1; const duration = this.numberField(values, 'duration_ms') ?? 0;
            const counter = session.profileCounters.get(name) ?? { category, count: 0, totalDurationMs: 0 }; counter.count += delta; counter.totalDurationMs += duration; session.profileCounters.set(name, counter);
        }
        return true;
    }

    protected parseTelemetryFields(text: string): Record<string, string> {
        const result: Record<string, string> = {}; const regex = /([A-Za-z0-9_.-]+)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g; let m: RegExpExecArray | null;
        while ((m = regex.exec(text))) result[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
        return result;
    }
    protected numberField(values: Record<string, string>, name: string): number | undefined { const value = Number(values[name]); return Number.isFinite(value) ? value : undefined; }
    protected traceCategory(value?: string): InuTraceEvent['category'] { const allowed = new Set(['boot','interrupt','syscall','scheduler','driver','memory','storage','network','graphics','diagnostic','custom']); return allowed.has((value ?? '').toLowerCase()) ? (value!.toLowerCase() as InuTraceEvent['category']) : 'custom'; }
    protected tracePhase(value?: string): InuTraceEvent['phase'] { const v=(value ?? 'instant').toLowerCase(); return v === 'begin' || v === 'end' ? v : 'instant'; }
    protected pushTraceEvent(session: RunSession, event: InuTraceEvent): void { event.id = session.traceEvents.length ? session.traceEvents[session.traceEvents.length - 1].id + 1 : 1; session.traceEvents.push(event); if (session.traceEvents.length > 25000) session.traceEvents.splice(0, session.traceEvents.length - 25000); }

    protected beginBootStage(session: RunSession, name: string, at: number, details?: string): void {
        session.currentBootStage = name; session.bootStages.set(name, { name, startMs: at, status: 'running', details });
        this.pushTraceEvent(session, { id: 0, timestampMs: at, category: 'boot', name, phase: 'begin', details });
    }
    protected endBootStage(session: RunSession, name: string, at: number, status: InuBootStage['status'] = 'complete', details?: string): void {
        const current = session.bootStages.get(name); const startMs = current?.startMs ?? at; const durationMs = Math.max(0, at - startMs);
        session.bootStages.set(name, { name, startMs, endMs: at, durationMs, status, details: details ?? current?.details }); session.currentBootStage = undefined;
        this.pushTraceEvent(session, { id: 0, timestampMs: at, category: 'boot', name, phase: 'end', durationMs, details });
        const key = `boot:${name}`; const sample = session.profileSamples.get(key) ?? { samples: 0, totalDurationMs: 0, category: 'boot' }; sample.samples++; sample.totalDurationMs += durationMs; session.profileSamples.set(key, sample);
    }

    protected ingestBootMilestone(session: RunSession, line: string, now: number): void {
        const milestones: Array<[string, string]> = [
            ['Inu KMain started.', 'Kernel entry'], ['Final UEFI memory map retained', 'UEFI handoff'], ['GDT and TSS installed.', 'CPU descriptors'], ['IDT with 256 vectors installed.', 'Interrupt table'], ['Legacy PIC masked', 'Interrupt controllers'], ['ACPI MADT, MCFG, HPET, FADT and platform power services online.', 'ACPI / platform'], ['HPET, Local APIC timer, TSC, RTC/CMOS and invariant-TSC clock source online.', 'Timers / clocks'], ['Physical memory manager initialized from final UEFI map.', 'Physical memory'], ['Virtual memory manager attached to active x64 page tables.', 'Virtual memory'], ['Kernel heap status:', 'Kernel heap'], ['SMP and per-CPU state online.', 'SMP / per-CPU'], ['Scheduler and threads online.', 'Scheduler'], ['User/kernel separation online.', 'Protection'], ['System calls online.', 'System calls']
        ];
        const hit = milestones.find(([needle]) => line.includes(needle)); if (!hit) return;
        const name = hit[1];
        if (session.currentBootStage && session.currentBootStage !== name) this.endBootStage(session, session.currentBootStage, now, 'complete');
        if (!session.bootStages.has(name)) this.beginBootStage(session, name, session.lastBootMilestoneMs ?? Math.max(0, now - 0.1));
        this.endBootStage(session, name, now, line.includes('[FAIL]') ? 'failed' : line.includes('[WARN]') ? 'warning' : 'complete', line);
        session.lastBootMilestoneMs = now;
    }

    protected traceSnapshotForSession(session: RunSession): InuTraceSnapshot {
        return { active: !session.complete, sessionId: session.sessionId, capturedAtUtc: new Date().toISOString(), elapsedMs: this.elapsedMs(session), events: session.traceEvents.map(item => ({ ...item })), bootStages: Array.from(session.bootStages.values()).sort((a,b)=>a.startMs-b.startMs).map(item => ({ ...item })), message: session.traceEvents.length ? undefined : 'Waiting for Inu kernel trace telemetry…' };
    }
    protected profilerSnapshotForSession(session: RunSession): InuProfilerSnapshot {
        const raw = Array.from(session.profileSamples.entries()); const totalSamples = raw.reduce((sum,[,v])=>sum+v.samples,0); const totalDuration = raw.reduce((sum,[,v])=>sum+v.totalDurationMs,0);
        const functions: InuProfilerFunction[] = raw.map(([name,v]) => ({ name: name.startsWith('boot:') ? name.slice(5) : name, category: v.category, samples: v.samples, totalDurationMs: v.totalDurationMs, averageDurationMs: v.samples ? v.totalDurationMs/v.samples : 0, percent: totalDuration > 0 ? v.totalDurationMs/totalDuration*100 : totalSamples ? v.samples/totalSamples*100 : 0 })).sort((a,b)=>b.percent-a.percent);
        const cpus: InuProfilerCpu[] = Array.from(session.profileCpuSamples.entries()).map(([cpuIndex,v])=>({ cpuIndex, samples:v.samples, busySamples:v.busySamples, utilisationPercent:v.samples ? v.busySamples/v.samples*100 : 0 })).sort((a,b)=>a.cpuIndex-b.cpuIndex);
        const counters: InuProfilerCounter[] = Array.from(session.profileCounters.entries()).map(([name,v])=>({ name, category:v.category, count:v.count, totalDurationMs:v.totalDurationMs || undefined, averageDurationMs:v.count && v.totalDurationMs ? v.totalDurationMs/v.count : undefined })).sort((a,b)=>b.count-a.count);
        const stages=Array.from(session.bootStages.values()).filter(s=>s.endMs!==undefined); const bootDurationMs=stages.length ? Math.max(...stages.map(s=>s.endMs!))-Math.min(...stages.map(s=>s.startMs)) : undefined;
        return { active: !session.complete, sessionId: session.sessionId, capturedAtUtc:new Date().toISOString(), elapsedMs:this.elapsedMs(session), totalSamples, functions, cpus, counters, bootDurationMs, message: totalSamples || counters.length ? undefined : 'Boot timing is collected automatically. Runtime CPU/function/counter profiling appears when the kernel emits [INU:PROFILE] telemetry.' };
    }

    protected async refreshSdkBridge(projectRoot: string): Promise<void> {
        const configurationPath = path.join(projectRoot, 'Inu.json');
        const parsed = JSON.parse(await fs.readFile(configurationPath, 'utf8')) as InuProjectConfiguration;
        const configuration = this.copyConfiguration(parsed);
        await this.createBaseDirectories(projectRoot, configuration);
        await fs.writeFile(configurationPath, this.configurationJson(configuration), 'utf8');
        await fs.writeFile(path.join(projectRoot, 'Inu.Configuration.json'), this.sdkConfigurationJson(configuration), 'utf8');
        await fs.writeFile(path.join(projectRoot, 'Inu.Configuration.props'), this.sdkConfigurationProps(configuration), 'utf8');
        await fs.writeFile(path.join(projectRoot, 'Inu.Configuration.targets'), this.sdkConfigurationTargets(configuration), 'utf8');
        await fs.writeFile(path.join(projectRoot, 'InuProject.json'), this.sdkProjectManifest(configuration), 'utf8');
        await fs.writeFile(path.join(projectRoot, 'Build.bat'), this.buildBatch(), 'utf8');
        await fs.writeFile(path.join(projectRoot, 'Run.bat'), this.runBatch(configuration), 'utf8');

        // Refresh Kath&Inu-owned mechanisms only. OS-named folders are coder-owned and are
        // created only when missing; they are never silently rewritten on open/run.
        const projects = this.buildProjectGraph(configuration);
        for (const generated of projects) await this.writeGeneratedProject(projectRoot, configuration, generated);
        await this.materializeSelectedManagedSdkSource(projectRoot, configuration);
        await this.materializeSelectedUserlandSource(projectRoot, configuration);
        await fs.mkdir(path.join(projectRoot, 'Kernel', 'Provided', 'Configuration'), { recursive: true });
        await fs.writeFile(path.join(projectRoot, 'Kernel', 'Provided', 'Configuration', 'GeneratedConfiguration.cs'), this.generatedConfigurationSource(configuration), 'utf8');
        await fs.mkdir(path.join(projectRoot, 'Kernel', 'Provided', 'Core'), { recursive: true });
        await fs.writeFile(path.join(projectRoot, 'Kernel', 'Provided', 'Core', 'KernelRuntime.cs'), this.kernelSource(configuration), 'utf8');
        await this.materializeCoderOwnedSource(projectRoot, configuration);
        await this.removeUnusedOptionalRoots(projectRoot);
    }

    async listDiskImages(projectPath: string): Promise<InuDiskImageDescriptor[]> {
        return this.diskImageService.listDiskImages(projectPath);
    }

    async inspectDiskImage(projectPath: string, imagePath: string): Promise<InuDiskImageInspection> {
        return this.diskImageService.inspectDiskImage(projectPath, imagePath);
    }

    async readDiskImage(projectPath: string, imagePath: string, offset: number, length: number): Promise<InuDiskReadResult> {
        return this.diskImageService.readDiskImage(projectPath, imagePath, offset, length);
    }

    async readDiskImageEntry(projectPath: string, imagePath: string, entryPath: string, offset: number, length: number): Promise<InuDiskReadResult> {
        return this.diskImageService.readDiskImageEntry(projectPath, imagePath, entryPath, offset, length);
    }


}
