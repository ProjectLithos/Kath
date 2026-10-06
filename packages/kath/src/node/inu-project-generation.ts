import * as fs from 'fs/promises';
import * as path from 'path';
import { InuProjectConfiguration } from '../common/inu-protocol';
import { KATH_ROOT, KATH_VERSION, INU_SDK_ROOT } from './inu-environment';

export interface GeneratedProject {
    id: string;
    relativePath: string;
    kind: 'kernel' | 'kernel-module' | 'service' | 'driver' | 'userland' | 'test';
    description: string;
}

interface InuCSharpImplementationDefinition {
    status: 'available' | 'planned' | 'not-applicable';
    project?: string | null;
    sources: string[];
}

interface InuSourceComponentDefinition {
    id: string;
    dependencies: string[];
    implementations?: { CSharp?: InuCSharpImplementationDefinition };
}

export abstract class InuProjectGenerationSupport {
    protected defaultCpuRoleAssignments() {
        return {
            kernel: '0', userland: 'all', gui: 'all', drivers: 'all', interrupts: 'all',
            networking: 'all', storage: 'all', realtime: 'all', background: 'all'
        };
    }

    protected normaliseKathInuConfiguration(configuration: InuProjectConfiguration): InuProjectConfiguration {
        const incoming = configuration as InuProjectConfiguration & { schemaVersion?: number };
        const kernelArchitecture = ['monolithic','microkernel','hybrid','custom'].includes(String(incoming.kernelArchitecture))
            ? incoming.kernelArchitecture : 'monolithic';
        const startupModel = ['none','cli','gui','cli-gui','custom'].includes(String((incoming as any).startupModel))
            ? (incoming as any).startupModel : ((incoming as any).gui && (incoming as any).gui !== 'none' ? ((incoming as any).shell && (incoming as any).shell !== 'none' ? 'cli-gui' : 'gui') : ((incoming as any).shell && (incoming as any).shell !== 'none' ? 'cli' : 'none'));
        const executableFormats = Array.isArray((incoming as any).executableFormats) && (incoming as any).executableFormats.length
            ? Array.from(new Set((incoming as any).executableFormats.filter((value: string) => ['elf64','pe64','flat','custom'].includes(value))))
            : ['elf64', 'pe64'];
        const hardwareSupport = Array.isArray((incoming as any).hardwareSupport)
            ? Array.from(new Set((incoming as any).hardwareSupport.filter((value: unknown) => typeof value === 'string')))
            : Array.from(new Set([
                ...((incoming.drivers ?? []) as string[]),
                ...((incoming.storageControllers ?? []) as string[]),
                ...((incoming.networkDrivers ?? []) as string[]),
                ...((incoming.input ?? []) as string[]),
                ...((incoming.graphics ?? []) as string[])
            ]));
        const customExecutionPlacements = Object.fromEntries(
            Object.entries(((incoming as any).customExecutionPlacements ?? {}) as Record<string, unknown>)
                .filter(([, value]) => value === 'kernel' || value === 'userland')
        ) as InuProjectConfiguration['customExecutionPlacements'];
        const roles = incoming.cpuRoles ?? this.defaultCpuRoleAssignments();
        const qemuCpuCount = Number.isInteger(incoming.qemuCpuCount) && incoming.qemuCpuCount >= 1 && incoming.qemuCpuCount <= 256 ? incoming.qemuCpuCount : 4;
        const author = typeof incoming.author === 'string' && incoming.author.trim() ? incoming.author.trim() : 'The DCL Group';
        const userland = startupModel !== 'none';
        const shell = startupModel === 'cli' || startupModel === 'cli-gui' ? 'inu-shell' : 'none';
        const gui = startupModel === 'gui' || startupModel === 'cli-gui' ? 'desktop' : 'none';
        return {
            ...incoming,
            schemaVersion: 9,
            name: incoming.name,
            author,
            location: (incoming.location || '').trim(),
            logoPath: typeof (incoming as any).logoPath === 'string' ? (incoming as any).logoPath.trim() : '',
            kernelArchitecture,
            targetArchitecture: 'x86_64',
            bootArchitecture: 'uefi',
            executableFormats: executableFormats as InuProjectConfiguration['executableFormats'],
            startupModel,
            hardwareSupport: hardwareSupport as string[],
            customExecutionPlacements,
            qemuCpuCount,
            memorySystem: incoming.memorySystem ?? 'paged',
            scheduler: incoming.scheduler ?? 'preemptive',
            processSupport: incoming.processSupport ?? 'processes',
            syscallModel: incoming.syscallModel ?? 'inu',
            smp: incoming.smp ?? true,
            cpuRoles: { ...roles },
            interruptModel: incoming.interruptModel ?? 'apic',
            timers: [...(incoming.timers ?? ['tsc','hpet','local-apic','rtc'])],
            drivers: [...(incoming.drivers ?? [])],
            storageControllers: [...(incoming.storageControllers ?? [])],
            filesystem: incoming.filesystem ?? 'none',
            networkStack: incoming.networkStack ?? 'none',
            networkDrivers: [...(incoming.networkDrivers ?? [])],
            input: [...(incoming.input ?? [])],
            graphics: [...(incoming.graphics ?? [])],
            audio: incoming.audio ?? 'none',
            userland,
            shell,
            gui,
            guiDesktopPath: (incoming.guiDesktopPath || '/BIN/INU-DESKTOP.EXE').trim(),
            guiLoginPath: (incoming.guiLoginPath || '/BIN/INU-LOGIN.EXE').trim(),
            debugging: [...(incoming.debugging ?? ['serial-log','kernel-diagnostics'])],
            testing: [...(incoming.testing ?? [])],
            virtualisation: incoming.virtualisation ?? 'guest',
            safetyProfile: incoming.safetyProfile ?? 'general',
            safetyOptions: [...(incoming.safetyOptions ?? [])]
        };
    }

    protected migrateLegacyCpuRoleDefaults(configuration: InuProjectConfiguration): { configuration: InuProjectConfiguration; migrated: boolean } {
        const normalised = this.normaliseKathInuConfiguration(configuration);
        const migrated = (configuration as any).schemaVersion !== 9 || JSON.stringify(normalised) !== JSON.stringify(configuration);
        return { configuration: normalised, migrated };
    }

    protected copyConfiguration(configuration: InuProjectConfiguration): InuProjectConfiguration {
        return this.normaliseKathInuConfiguration(configuration);
    }

    protected async readGeneratedProjectGraph(projectRoot: string): Promise<GeneratedProject[]> {
        try {
            const graph = JSON.parse(await fs.readFile(path.join(projectRoot, 'Inu.ProjectGraph.json'), 'utf8')) as { projects?: GeneratedProject[] };
            return Array.isArray(graph.projects) ? graph.projects.filter(project =>
                !!project && typeof project.id === 'string' && typeof project.relativePath === 'string') : [];
        } catch {
            return [];
        }
    }

    protected generatedProjectDirectory(projectRoot: string, relativePath: string): string {
        const normalised = relativePath.replace(/\\/g, '/');
        const segments = normalised.split('/').filter(segment => segment.length > 0);
        if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
            throw new Error(`Invalid generated project path in Inu.ProjectGraph.json: ${relativePath}`);
        }
        const directory = path.resolve(projectRoot, ...segments);
        const relative = path.relative(projectRoot, directory);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`Generated project path escapes the Inu OS root: ${relativePath}`);
        }
        return directory;
    }

    protected async removeObsoleteGeneratedProjects(
        projectRoot: string,
        previousProjects: GeneratedProject[],
        nextProjects: GeneratedProject[],
        osName: string
    ): Promise<void> {
        const keep = new Set(nextProjects.map(project => `${project.id}\n${project.relativePath}`));
        for (const project of previousProjects) {
            if (keep.has(`${project.id}\n${project.relativePath}`) || project.id === 'Kernel.Core') {
                continue;
            }

            const projectDirectory = this.generatedProjectDirectory(projectRoot, project.relativePath);
            const projectFile = path.join(projectDirectory, `${this.safeSegment(osName)}.${this.safeSegment(project.id)}.csproj`);
            await fs.rm(projectFile, { force: true });
            await fs.rm(path.join(projectDirectory, 'GeneratedFeature.cs'), { force: true });
            await this.removeEmptyGeneratedDirectories(projectDirectory, projectRoot);
        }
    }

    protected async removeEmptyGeneratedDirectories(directory: string, projectRoot: string): Promise<void> {
        let current = directory;
        while (current.toLowerCase() !== projectRoot.toLowerCase()) {
            try {
                const entries = await fs.readdir(current);
                if (entries.length !== 0) {
                    return;
                }
                await fs.rmdir(current);
                current = path.dirname(current);
            } catch {
                return;
            }
        }
    }

    protected validate(configuration: InuProjectConfiguration): string | undefined {
        if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(configuration.name)) {
            return 'Project name must begin with a letter and contain only letters, numbers, dot, underscore or hyphen.';
        }
        if (!(configuration.location || '').trim()) return 'Choose a folder in which to save the operating system.';
        if (((configuration.author || '').trim() || 'The DCL Group').length > 128) return 'Author / copyright owner must be 128 characters or fewer.';
        if (configuration.targetArchitecture !== 'x86_64') return 'Kath&Inu currently supports x64 only.';
        if (configuration.bootArchitecture !== 'uefi') return 'Kath&Inu currently supports UEFI boot only.';
        if (!['monolithic','microkernel','hybrid','custom'].includes(configuration.kernelArchitecture)) return 'Select a supported kernel model.';
        if (!['none','cli','gui','cli-gui','custom'].includes(configuration.startupModel)) return 'Select a supported startup model.';
        if (!Array.isArray(configuration.executableFormats) || configuration.executableFormats.length === 0) return 'Select at least one executable format.';
        if (!Number.isInteger(configuration.qemuCpuCount) || configuration.qemuCpuCount < 1 || configuration.qemuCpuCount > 256) return 'QEMU logical CPU count must be between 1 and 256.';
        return undefined;
    }

    protected isValidCpuSetSpecification(value: string, cpuCount: number): boolean {
        const text = (value ?? '').trim().toLowerCase();
        if (text === 'all') return true;
        if (!text) return false;
        for (const token of text.split(',')) {
            const part = token.trim();
            const match = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(part);
            if (!match) return false;
            const first = Number(match[1]);
            const last = match[2] === undefined ? first : Number(match[2]);
            if (first < 0 || last < first || last >= cpuCount) return false;
        }
        return true;
    }

    protected cpuSetWords(specification: string, cpuCount: number, allIncludesBootstrap: boolean): [bigint,bigint,bigint,bigint] {
        const words: [bigint,bigint,bigint,bigint] = [0n,0n,0n,0n];
        const text = specification.trim().toLowerCase();
        if (text === 'all') {
            const first = allIncludesBootstrap ? 0 : 1;
            for (let cpu=first; cpu<cpuCount; cpu++) words[Math.floor(cpu/64)] |= 1n << BigInt(cpu%64);
            return words;
        }
        for (const token of text.split(',')) {
            const [firstText,lastText] = token.trim().split('-');
            const first = Number(firstText); const last = lastText === undefined ? first : Number(lastText);
            for (let cpu=first; cpu<=last; cpu++) words[Math.floor(cpu/64)] |= 1n << BigInt(cpu%64);
        }
        return words;
    }

    protected cpuRoleSetupSource(configuration: InuProjectConfiguration): string {
        if (!configuration.smp) return '        // SMP CPU-role affinity is disabled by the configuration.';
        const roles = configuration.cpuRoles;
        const entries: Array<[string,string,boolean]> = [['Kernel','kernel',true],['Userland','userland',false],['Gui','gui',false],['Drivers','drivers',false],['Interrupts','interrupts',false],['Networking','networking',false],['Storage','storage',false],['Realtime','realtime',false],['Background','background',false]];
        const hex = (v: bigint) => `0x${v.toString(16).toUpperCase().padStart(16,'0')}UL`;
        return entries.map(([enumName,key,allIncludesBootstrap]) => { const w=this.cpuSetWords((roles as any)[key], configuration.qemuCpuCount, allIncludesBootstrap); return `        if (!KernelSmp.SetRoleCpuSet(KernelCpuRole.${enumName}, new KernelCpuSet(${w.map(hex).join(', ')}))) return false;`; }).join('\n');
    }

    protected async ensureCpuRoleConfigurationHook(projectRoot: string, configuration: InuProjectConfiguration): Promise<void> {
        const kernelPath = path.join(projectRoot, 'Kernel', 'Kernel.cs');
        try {
            let source = await fs.readFile(kernelPath, 'utf8');
            const legacyConfigurationUsing = `using ${this.namespace(configuration.name)}.Configuration;`;
            let changed = false;

            // 0.33.2 generated kernels embedded role masks directly in user-owned Kernel.cs.
            // Replace only that exact generated block with the generator-owned runtime hook.
            const embeddedRoleBlock = /(?:[ \t]*if \(!KernelSmp\.SetRoleCpuSet\(KernelCpuRole\.(?:Kernel|Userland|Gui|Drivers|Interrupts|Networking|Storage|Realtime|Background), new KernelCpuSet\([^\r\n]+\)\)\) return false;\r?\n){9}/g;
            if (embeddedRoleBlock.test(source)) {
                source = source.replace(embeddedRoleBlock, '        if (!GeneratedConfiguration.ApplyCpuRoles()) return false;\n');
                changed = true;
            }

            // Kernels created before CPU-role configuration existed need one small integration hook.
            if (!source.includes('GeneratedConfiguration.ApplyCpuRoles()')) {
                const smpInitialize = '        if (!KernelSmp.Initialize(boot)) return false;';
                if (source.includes(smpInitialize)) {
                    source = source.replace(smpInitialize, `${smpInitialize}\n        if (!GeneratedConfiguration.ApplyCpuRoles()) return false;`);
                    changed = true;
                }
            }

            // GeneratedConfiguration is compiled into the bootstrap assembly and shares the
            // stable Inu.Kernel.Bootstrap namespace. Remove the historical OS-name-derived
            // import so folder numbering/display names can never break kernel compilation.
            if (source.includes(legacyConfigurationUsing)) {
                source = source.replace(`${legacyConfigurationUsing}\n`, '');
                changed = true;
            }

            // 0.41.0: older generated kernels initialized graphics support inconsistently. Migrate
            // only kernels carrying Inu's generated architecture summaries; arbitrary user
            // Kernel.cs files are not rewritten. The bridge stays in Bootstrap so Console never
            // takes a project reference on Graphics/Drivers and the NuGet graph remains acyclic.
            const generatedMicrokernel = source.includes('/// <summary>Minimal-privilege microkernel: mechanisms stay in kernel; device and high-level services live outside it.</summary>');
            const generatedHybrid = source.includes('/// <summary>Hybrid kernel: core mechanisms and latency-sensitive driver/input facilities stay kernel-resident.</summary>');
            const generatedMonolithic = source.includes('/// <summary>Monolithic kernel: every configured kernel facility is initialized directly in one privileged runtime.</summary>');
            if (!source.includes('TryUseVirtioGpuConsole()') && (generatedMicrokernel || generatedHybrid || generatedMonolithic)) {
                if (source.includes('public static class Kernel')) source = source.replace('public static class Kernel', 'public static unsafe class Kernel');
                let extra = '';
                if (generatedMicrokernel) {
                    if (!source.includes('using Inu.Kernel.Virtio.Gpu;')) source = source.replace('using Inu.Kernel.TimerDispatch;\n', 'using Inu.Kernel.TimerDispatch;\nusing Inu.Kernel.Drivers;\nusing Inu.Kernel.Pci;\nusing Inu.Kernel.Virtio.Gpu;\n');
                    const start = '        if (!StartMicrokernelMechanisms(boot)) return false;';
                    if (source.includes(start) && !source.includes('InitializeBootstrapGraphicsTransport()')) source = source.replace(start, `${start}\n        if (!BootstrapGraphicsTransportStartup.Initialize()) return false;`);
                    extra = `\n    private static Boolean InitializeBootstrapGraphicsTransport()\n    {\n        // VirtIO-GPU is the early-console transport exception; general microkernel drivers remain service/userland owned.\n        if (!KernelDrivers.Initialize()) return false;\n        if (!KernelPci.Initialize()) return false;\n        if (!KernelVirtioGpu.Initialize()) return false;\n        if (TryUseVirtioGpuConsole()) return KernelStructuredLogging.InfoLine("graphics", "Kernel.KMain", "VirtIO-GPU promoted to the primary console; UEFI GOP remains registered as fallback.");\n        if (HasVirtioGpuPciDevice()) return KernelStructuredLogging.WarningLine("graphics", "Kernel.KMain", "VirtIO-GPU PCI device was detected but could not be started/promoted; retaining UEFI GOP.");\n        return true;\n    }\n`;
                } else if (generatedHybrid) {
                    const oldGpu = '        if (!KernelVirtioGpu.Initialize()) return false;\n        return KernelDrivers.BindAndStartMatchingDevices();';
                    const newGpu = '        if (!KernelVirtioGpu.Initialize()) return false;\n        if (TryUseVirtioGpuConsole()) { if (!KernelStructuredLogging.InfoLine("graphics", "Kernel.KMain", "VirtIO-GPU promoted to the primary console; UEFI GOP remains registered as fallback.")) return false; }\n        else if (HasVirtioGpuPciDevice() && !KernelStructuredLogging.WarningLine("graphics", "Kernel.KMain", "VirtIO-GPU PCI device was detected but could not be started/promoted; retaining UEFI GOP.")) return false;\n        return KernelDrivers.BindAndStartMatchingDevices();';
                    if (source.includes(oldGpu)) source = source.replace(oldGpu, newGpu);
                } else {
                    const oldGpu = '        if (!KernelInterruptBroker.Initialize()) return false;\n        return KernelVirtioGpu.Initialize();';
                    const newGpu = '        if (!KernelInterruptBroker.Initialize()) return false;\n        if (!KernelVirtioGpu.Initialize()) return false;\n        if (TryUseVirtioGpuConsole()) return KernelStructuredLogging.InfoLine("graphics", "Kernel.KMain", "VirtIO-GPU promoted to the primary console; UEFI GOP remains registered as fallback.");\n        if (HasVirtioGpuPciDevice()) return KernelStructuredLogging.WarningLine("graphics", "Kernel.KMain", "VirtIO-GPU PCI device was detected but could not be started/promoted; retaining UEFI GOP.");\n        return true;';
                    if (source.includes(oldGpu)) source = source.replace(oldGpu, newGpu);
                }
                const classEnd = source.lastIndexOf('\n}');
                if (classEnd >= 0) {
                    source = `${source.slice(0, classEnd)}${extra}\n${this.virtioGpuConsoleBridgeSource()}${source.slice(classEnd)}`;
                    changed = true;
                }
            }


            // 0.41.8: 0.41.0-0.41.7 generated bridges rebound the console and reported a
            // successful VirtIO-GPU promotion without calling the deferred scanout activation
            // introduced in 0.41.5. Upgrade only Inu-generated kernels and leave user-owned
            // custom Kernel.cs files untouched.
            if ((generatedMicrokernel || generatedHybrid || generatedMonolithic) &&
                source.includes('TryUseVirtioGpuConsole()') &&
                !source.includes('KernelVirtioGpu.ActivateDisplay(selected.Handle)')) {
                const setPrimary = '        if (!KernelGraphics.SetPrimaryDisplay(selected.Handle))';
                if (source.includes(setPrimary)) {
                    const activation = `        // Bind the populated VirtIO resource to the physical scanout before declaring promotion.\n        if (!KernelVirtioGpu.ActivateDisplay(selected.Handle))\n        {\n            _consoleGraphicsDisplay = oldConsoleDisplay;\n            RestorePreviousGraphicsDisplay(havePrevious, previous);\n            return false;\n        }\n`;
                    source = source.replace(setPrimary, `${activation}${setPrimary}`);
                    changed = true;
                }
            }
            if (changed) await fs.writeFile(kernelPath, source, 'utf8');

            // 0.41.4: VirtIO-GPU is an early console transport in every kernel topology. Because
            // Bootstrap disables transitive project references, its three direct namespaces must
            // always be explicit even when the general Drivers work area belongs to userland.
            const bootstrapProjectPath = path.join(projectRoot, 'InuKernel.csproj');
            try {
                let project = await fs.readFile(bootstrapProjectPath, 'utf8');
                const before = project;
                project = project.replace(/(<ProjectReference Include="Sdk\\Inu\.Kernel\.Drivers\\Inu\.Kernel\.Drivers\.csproj") Condition="[^"]+" \/>/, '$1 />');
                project = project.replace(/(<ProjectReference Include="Sdk\\Inu\.Kernel\.Pci\\Inu\.Kernel\.Pci\.csproj") Condition="[^"]+" \/>/, '$1 />');
                project = project.replace(/(<ProjectReference Include="Sdk\\Inu\.Kernel\.Virtio\.Gpu\\Inu\.Kernel\.Virtio\.Gpu\.csproj") Condition="[^"]+" \/>/, '$1 />');
                if (project !== before) await fs.writeFile(bootstrapProjectPath, project, 'utf8');
            } catch {
                // Non-standard projects without the generated bootstrap project are left untouched.
            }
        } catch {
            // A missing or non-standard user kernel is left untouched.
        }
    }

    protected async createBaseDirectories(projectRoot: string, configuration: InuProjectConfiguration): Promise<void> {
        const osName = this.safeSegment(configuration.name);

        // Remove only SDK-owned remnants of the pre-partitioned layout. Never remove
        // Boot/<OSName>, Kernel/<OSName> or Userland/<OSName>.
        for (const legacy of [
            path.join(projectRoot, 'HAL'),
            path.join(projectRoot, 'Startup'),
            path.join(projectRoot, 'Userland', 'Shell')
        ]) {
            await fs.rm(legacy, { recursive: true, force: true });
        }
        for (const legacyBootFile of [
            'AcpiStartup.cs','BootDiagnosticsStartup.cs','GraphicsStartup.cs','KernelPanicTransport.cs',
            'KernelStructuredLogging.cs','MemoryRuntimeStartup.cs','PlatformTablesStartup.cs',
            'ProtectionStartup.cs','SchedulerRuntimeStartup.cs','SmpStartup.cs','TimeStartup.cs'
        ]) {
            await fs.rm(path.join(projectRoot, 'Boot', legacyBootFile), { force: true });
        }
        for (const area of ['Boot','Kernel','Userland']) {
            await fs.mkdir(path.join(projectRoot, area, 'Provided'), { recursive: true });
            await fs.mkdir(path.join(projectRoot, area, osName), { recursive: true });
        }
    }

    protected async writeCoderOwnedFile(filePath: string, source: string): Promise<void> {
        let exists = false;
        try { await fs.access(filePath); exists = true; } catch { }
        if (exists) {
            if (path.basename(filePath) === 'Echo.cs') {
                // Repair only the literal newline emitted by the old Echo template.
                // Preserve every other edit in this coder-owned source file.
                const current = await fs.readFile(filePath, 'utf8');
                const repaired = current.replace(/return UserlandConsole\.Write\("\r?\n"\)\?0:3;/g,
                    'return UserlandConsole.Write("\\n")?0:3;');
                if (repaired !== current) await fs.writeFile(filePath, repaired, 'utf8');
            }
            if (path.basename(filePath) === 'SysInfo.cs') {
                const current = await fs.readFile(filePath, 'utf8');
                const ns = /namespace ([A-Za-z_][A-Za-z0-9_.]*);/.exec(current)?.[1];
                const shipped = ns ? "namespace ${ns};\n\n/// <summary>\n/// Editable system-information executable. The working implementation should query the kernel\n/// hardware inventory and report detected hardware separately from driver/support state, e.g.\n/// \"NVMe: Present\" and \"NVMe driver: Missing\".\n/// </summary>\npublic static class SysInfo\n{\n    public static int Main()\n    {\n        return global::Inu.Userland.Runtime.UserlandConsole.WriteLine(\"Hardware/support inventory will be supplied by SysInfo item 3.\")?0:1;\n    }\n}\n" : '';
                if (ns && current.trim() === shipped.replace('${ns}', ns).trim()) {
                    await fs.writeFile(filePath, source.replace(/namespace [A-Za-z_][A-Za-z0-9_.]*;/, `namespace ${ns};`), 'utf8');
                }
            }
            return;
        }
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, source, 'utf8');
    }

    protected kernelUsingDirectives(configuration: InuProjectConfiguration): string {
        // Kernel/<OSName>/Kernel.cs is coder-owned policy source. Never inherit imports
        // from Inu's generated bootstrap implementation: bootstrap/HAL namespaces are
        // implementation detail, not the SDK surface promised to the OS author.
        const areas = this.sdkKernelAreas(configuration);
        const directives: string[] = [
            'using System;',
            'using Inu.Kernel.Console;',
            'using Inu.Kernel.Memory;',
            'using Inu.Kernel.Processes;',
            'using Inu.Kernel.SystemCalls;',
            'using Inu.Kernel.Interrupts;',
            'using Inu.Kernel.Time;',
            'using Inu.Kernel.Power;'
        ];

        if (areas.Scheduler) directives.push('using Inu.Kernel.Scheduler;');
        if (configuration.smp) directives.push('using Inu.Kernel.Smp;');
        if (areas.Drivers) { directives.push('using Inu.Kernel.Drivers;'); directives.push('using Inu.Kernel.Hardware;'); }
        if (areas.Storage || areas.Filesystems) directives.push('using Inu.Kernel.Storage;');
        if (configuration.graphics.length > 0) directives.push('using Inu.Kernel.Graphics;');
        if (areas.Input) directives.push('using Inu.Kernel.Input;');
        if (areas.Networking) directives.push('using Inu.Kernel.Networking;');
        if (configuration.audio !== 'none' && this.driverKind(configuration, `hardware:${configuration.audio}`) === 'kernel-module') directives.push('using Inu.Kernel.Audio;');

        return `${Array.from(new Set(directives)).join('\n')}\n\n`;
    }

    protected async materializeRequiredConsoleFont(projectRoot: string): Promise<void> {
        const destination = path.join(projectRoot, 'Kernel', 'Provided', 'Assets', 'Fonts', 'TrueType', 'Console.ttf');
        try { await fs.access(destination); return; } catch { }

        const candidates: string[] = [
            path.join(KATH_ROOT, 'Assets', 'Fonts', 'TrueType', 'Console.ttf'),
            path.join(KATH_ROOT, 'Assets', 'Fonts', 'TrueType', 'DejaVuSansMono.ttf'),
            path.join(INU_SDK_ROOT, 'Assets', 'Fonts', 'TrueType', 'Console.ttf'),
            path.join(INU_SDK_ROOT, 'Assets', 'Fonts', 'TrueType', 'DejaVuSansMono.ttf')
        ];
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
            candidates.push(path.join(localAppData, 'Microsoft', 'Windows', 'Fonts', 'CascadiaMono.ttf'));
            candidates.push(path.join(localAppData, 'Microsoft', 'Windows', 'Fonts', 'CascadiaCode.ttf'));
        }
        const windowsRoot = process.env.WINDIR || process.env.SystemRoot;
        if (windowsRoot) {
            candidates.push(path.join(windowsRoot, 'Fonts', 'consola.ttf'));
            candidates.push(path.join(windowsRoot, 'Fonts', 'lucon.ttf'));
            candidates.push(path.join(windowsRoot, 'Fonts', 'cour.ttf'));
        }

        for (const candidate of candidates) {
            try {
                await fs.access(candidate);
                await fs.mkdir(path.dirname(destination), { recursive: true });
                await fs.copyFile(candidate, destination);
                return;
            } catch { }
        }
        throw new Error('Kath&Inu requires a TrueType console font but none was found in Kath/Inu assets or the Windows font directories.');
    }

    protected async materializeCoderOwnedSource(projectRoot: string, configuration: InuProjectConfiguration): Promise<void> {
        await this.materializeRequiredConsoleFont(projectRoot);
        const osName = this.safeSegment(configuration.name);
        const ns = `KathInu.${this.namespace(configuration.name)}`;
        const kernelUsings = this.kernelUsingDirectives(configuration);
        await this.writeCoderOwnedFile(path.join(projectRoot, 'Boot', osName, 'Boot.cs'),
`namespace ${ns}.Boot;

/// <summary>Coder-owned boot customisation. Kath&Inu never silently overwrites this file.</summary>
public static class Boot
{
    public static void Configure()
    {
    }
}
`);
        const kernelStartup = configuration.startupModel === 'gui'
            ? `        global::${ns}.Userland.Gui.Configure();\n        return DesktopOrTextSessionStartup.Run();`
            : configuration.startupModel === 'cli' || configuration.startupModel === 'cli-gui'
                ? `        return TextConsoleSessionStartup.Run();`
                : '        return true;';
        await this.writeCoderOwnedFile(path.join(projectRoot, 'Kernel', osName, 'Kernel.cs'),
`${kernelUsings}namespace ${ns}.Kernel;

/// <summary>
/// Coder-owned kernel policy. Kath&Inu never silently overwrites this file.
/// The using directives above are the stable kernel-facing SDK surface for the
/// facilities selected for this OS; Inu bootstrap/HAL implementation namespaces
/// are intentionally not imported here.
/// </summary>
public static class Kernel
{
    public static Boolean Start()
    {
        // This method owns post-bootstrap OS policy. Examples of supported policy
        // controls (when selected) include Console, Time, Scheduler, Smp, Drivers,
        // FileSystem, Graphics, Input, Networking, Audio and Power lifecycle facades.
${kernelStartup}
    }
}
`);
        if (configuration.startupModel === 'cli' || configuration.startupModel === 'cli-gui') {
            await this.writeCoderOwnedFile(path.join(projectRoot, 'Userland', osName, 'Shell.cs'),
`using System;

namespace ${ns}.Userland;

/// <summary>Coder-owned shell behaviour. Executable discovery/launch is supplied by Userland/Provided/Shell.</summary>
public static class Shell
{
    /// <summary>The text displayed before each command line. Change this to customise the shell prompt.</summary>
    public const string Prompt = "> ";

    public static void Configure()
    {
        // Standard freestanding .NET console API supplied by Inu:
        // Console.WriteLine("Howdy");
    }
}
`);
            const commands = path.join(projectRoot, 'Userland', osName, 'Commands');
            await this.writeCoderOwnedFile(path.join(commands, 'Echo.cs'),
`using System;
using Inu.Userland.Runtime;

namespace ${ns}.Userland.Commands;

/// <summary>Editable starter executable. It is a real ring-3 program, not a shell built-in.</summary>
public static unsafe class Echo
{
    public static int Main()
    {
        Byte* arguments=stackalloc Byte[2048];
        Int32 length=UserlandArguments.ReadRaw(arguments,2048U);
        if(length<0)return 1;
        if(length!=0)
        {
            if(UserlandSystem.Call(UserlandOperation.Event,"console.output",arguments,(UInt64)length,null,0UL)<0L)return 2;
        }
        return UserlandConsole.Write("\\n")?0:3;
    }
}
`);
            const sysInfo = await fs.readFile(path.join(INU_SDK_ROOT, 'src', 'Userland', 'SysInfo', 'SysInfo.cs'), 'utf8');
            await this.writeCoderOwnedFile(path.join(commands, 'SysInfo.cs'),
                sysInfo.replace('namespace Inu.Userland.Commands;', `namespace ${ns}.Userland.Commands;`));
            if (configuration.startupModel === 'cli-gui') {
                await this.writeCoderOwnedFile(path.join(commands, 'Gui.cs'),
`namespace ${ns}.Userland.Commands;

/// <summary>
/// Shell-visible GUI command. The CLI is the initial environment when CLI + GUI is selected;
/// this executable is the explicit entry point used to launch the OS GUI from the shell.
/// </summary>
public static class GuiCommand
{
    public static int Main(string[] args)
    {
        return global::${ns}.Userland.Gui.Run(args);
    }
}
`);
            }
        }
        if (configuration.startupModel === 'gui' || configuration.startupModel === 'cli-gui') {
            await this.writeCoderOwnedFile(path.join(projectRoot, 'Userland', osName, 'Gui.cs'),
`namespace ${ns}.Userland;

/// <summary>Coder-owned GUI behaviour. Low-level graphical mechanisms live under Userland/Provided/Gui.</summary>
public static class Gui
{
    public static void Configure()
    {
    }

    /// <summary>GUI executable entry used by direct GUI startup or the generated shell GUI command.</summary>
    public static int Run(string[] args)
    {
        Configure();
        return 0;
    }
}
`);
        }
        if (configuration.logoPath) {
            try {
                const source = path.resolve(configuration.logoPath);
                if (path.extname(source).toLowerCase() !== '.bmp') throw new Error('The Kath&Inu logo must be a BMP file.');
                const assets = path.join(projectRoot, 'Assets');
                await fs.mkdir(assets, { recursive: true });
                await fs.copyFile(source, path.join(assets, 'Logo.bmp'));
            } catch (error) {
                throw new Error(`Could not copy OS logo: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    protected buildProjectGraph(configuration: InuProjectConfiguration): GeneratedProject[] {
        const projects: GeneratedProject[] = [
            this.project(configuration, 'Kernel.Core', 'kernel', 'Core kernel and KMain entry point', 'Core')
        ];

        projects.push(this.project(configuration, `Architecture.${configuration.targetArchitecture}`, 'kernel-module', 'CPU architecture support', 'Architecture'));
        projects.push(this.project(configuration, `Boot.${configuration.bootArchitecture}`, 'kernel-module', 'Boot architecture support', 'Boot'));
        projects.push(this.project(configuration, `Memory.${configuration.memorySystem}`, 'kernel-module', 'Memory-system implementation', 'Memory'));
        projects.push(this.project(configuration, `Interrupts.${configuration.interruptModel}`, 'kernel-module', 'Interrupt-controller implementation', 'Interrupts'));

        if (configuration.scheduler !== 'none') {
            projects.push(this.project(configuration, `Scheduler.${configuration.scheduler}`, 'kernel-module', 'Scheduler implementation', 'Scheduler'));
        }
        if (configuration.processSupport !== 'none') {
            projects.push(this.project(configuration, `Processes.${configuration.processSupport}`, 'kernel-module', 'Thread/process and communication support', 'Processes'));
        }
        projects.push(this.project(configuration, `Syscalls.${configuration.syscallModel}`, 'kernel-module', 'System-call dispatch model', 'Syscalls'));

        if (configuration.smp) {
            projects.push(this.project(configuration, 'Smp', 'kernel-module', 'Symmetric multiprocessing and per-CPU support', 'Smp'));
        }
        for (const timer of configuration.timers) {
            projects.push(this.project(configuration, `Timer.${timer}`, 'kernel-module', `${timer} timer/clock support`, 'Timers'));
        }
        for (const driver of configuration.drivers) {
            projects.push(this.project(configuration, `Driver.${driver}`, this.driverKind(configuration, `hardware:${driver}`), `${driver} device driver`, 'Drivers'));
        }
        for (const storage of configuration.storageControllers) {
            projects.push(this.project(configuration, `Storage.${storage}`, this.driverKind(configuration, `hardware:${storage}`), `${storage} storage controller`, 'Storage'));
        }
        if (configuration.filesystem !== 'none') {
            projects.push(this.project(configuration, `Filesystem.${configuration.filesystem}`, this.serviceKind(configuration, 'service:filesystem'), `${configuration.filesystem} filesystem`, 'Filesystem'));
        }
        if (configuration.networkStack !== 'none') {
            projects.push(this.project(configuration, `Networking.${configuration.networkStack}`, this.serviceKind(configuration, 'service:networking'), `${configuration.networkStack} networking stack`, 'Networking'));
            for (const driver of configuration.networkDrivers) {
                projects.push(this.project(configuration, `NetworkDriver.${driver}`, this.driverKind(configuration, `hardware:${driver}`), `${driver} network adapter driver`, 'NetworkDrivers'));
            }
        }
        for (const input of configuration.input) {
            projects.push(this.project(configuration, `Input.${input}`, this.driverKind(configuration, `hardware:${input}`), `${input} input support`, 'Input'));
        }
        for (const graphics of configuration.graphics) {
            projects.push(this.project(configuration, `Graphics.${graphics}`, this.driverKind(configuration, `hardware:${graphics}`), `${graphics} graphics support`, 'Graphics'));
        }
        if (configuration.audio !== 'none') {
            projects.push(this.project(configuration, `Audio.${configuration.audio}`, this.driverKind(configuration, `hardware:${configuration.audio}`), `${configuration.audio} audio support`, 'Audio'));
        }
        if (configuration.virtualisation !== 'none') {
            projects.push(this.project(configuration, `Virtualisation.${configuration.virtualisation}`, 'kernel-module', `${configuration.virtualisation} virtualisation support`, 'Virtualisation'));
        }
        if (configuration.debugging.length > 0) {
            projects.push(this.project(configuration, 'Debugging', 'kernel-module', 'Selected debugging facilities', 'Debugging'));
        }
        if (configuration.safetyProfile !== 'general' || configuration.safetyOptions.length > 0) {
            projects.push(this.project(configuration, `Safety.${configuration.safetyProfile}`, 'kernel-module', 'RTOS/safety policy and enforcement hooks', 'Safety'));
        }
        if (configuration.userland) {
            projects.push(this.project(configuration, 'Userland.Runtime', 'userland', 'Base userland runtime', 'Runtime'));
            if (configuration.shell !== 'none') {
                projects.push(this.project(configuration, `Shell.${configuration.shell}`, 'userland', 'Inu command shell', 'Shell'));
            }
            if (configuration.gui !== 'none') {
                projects.push(this.project(configuration, `Gui.${configuration.gui}`, 'userland', 'Graphical user interface', 'Gui'));
            }
        }
        for (const test of configuration.testing) {
            projects.push(this.project(configuration, `Test.${test}`, 'test', `${test} test program`, 'Tests'));
        }

        return projects;
    }

    protected project(
        configuration: InuProjectConfiguration,
        id: string,
        kind: GeneratedProject['kind'],
        description: string,
        group: string
    ): GeneratedProject {
        const safeId = this.safeSegment(id);
        let relativePath: string;
        if (id.toLowerCase().startsWith('boot.')) {
            relativePath = path.posix.join('Boot', 'Provided', group, safeId);
        } else if (kind === 'userland' || kind === 'test') {
            relativePath = path.posix.join('Userland', 'Provided', group, safeId);
        } else if (kind === 'service' || kind === 'driver') {
            relativePath = path.posix.join('Userland', 'Provided', kind === 'driver' ? 'Drivers' : 'Services', group, safeId);
        } else {
            relativePath = path.posix.join('Kernel', 'Provided', group, safeId);
        }
        return { id, relativePath, kind, description };
    }

    protected customExecutionArea(configuration: InuProjectConfiguration, key: string): 'kernel' | 'userland' {
        return configuration.customExecutionPlacements?.[key] === 'kernel' ? 'kernel' : 'userland';
    }

    protected driverKind(configuration: InuProjectConfiguration, placementKey: string): GeneratedProject['kind'] {
        if (configuration.kernelArchitecture === 'monolithic') return 'kernel-module';
        if (configuration.kernelArchitecture === 'microkernel') return 'driver';
        if (configuration.kernelArchitecture === 'hybrid') return 'kernel-module';
        return this.customExecutionArea(configuration, placementKey) === 'kernel' ? 'kernel-module' : 'driver';
    }

    protected serviceKind(configuration: InuProjectConfiguration, placementKey: string): GeneratedProject['kind'] {
        if (configuration.kernelArchitecture === 'monolithic') return 'kernel-module';
        if (configuration.kernelArchitecture === 'microkernel') return 'service';
        if (configuration.kernelArchitecture === 'hybrid') return 'service';
        return this.customExecutionArea(configuration, placementKey) === 'kernel' ? 'kernel-module' : 'service';
    }

    protected async writeGeneratedProject(projectRoot: string, configuration: InuProjectConfiguration, project: GeneratedProject): Promise<void> {
        const projectDirectory = path.join(projectRoot, ...project.relativePath.split('/'));
        await fs.mkdir(projectDirectory, { recursive: true });

        const projectFileName = `${this.safeSegment(configuration.name)}.${this.safeSegment(project.id)}.csproj`;
        await fs.rm(path.join(projectDirectory, 'GeneratedFeature.cs'), { force: true });

        // Kernel-side architecture nodes are source folders inside the one kernel project.
        // They are not separate .NET projects. Drivers/services remain separate projects only
        // when the selected OS architecture makes them separate executables.
        if (project.kind === 'kernel' || project.kind === 'kernel-module') {
            await this.materializeGeneratedProjectSource(projectRoot, projectDirectory, project, configuration);
            await fs.rm(path.join(projectDirectory, projectFileName), { force: true });
        } else if (project.kind === 'driver' || project.kind === 'service') {
            await this.materializeGeneratedProjectSource(projectRoot, projectDirectory, project, configuration);
            await fs.writeFile(path.join(projectDirectory, projectFileName), await this.csProject(projectRoot, projectDirectory, configuration, project), 'utf8');
        } else {
            await this.materializeFeatureOwnedSource(projectDirectory, project);
            await fs.writeFile(path.join(projectDirectory, projectFileName), await this.csProject(projectRoot, projectDirectory, configuration, project), 'utf8');
        }
    }

    protected featureSourceDirectoryForGeneratedProject(project: GeneratedProject): string | undefined {
        const id = project.id.toLowerCase();
        if (id === 'userland.runtime') return path.join(INU_SDK_ROOT, 'src', 'Inu.Userland.Runtime');
        if (id === 'shell.inu-shell') return path.join(INU_SDK_ROOT, 'src', 'Userland', 'Shell');
        if (id.startsWith('gui.')) return path.join(INU_SDK_ROOT, 'src', 'Userland', 'Gui');
        const tests: Record<string, string> = {
            'test.boot-smoke': 'BootSmoke',
            'test.memory': 'Memory',
            'test.interrupts': 'Interrupts',
            'test.scheduler': 'Scheduler',
            'test.drivers': 'Drivers',
            'test.network': 'Networking'
        };
        const test = tests[id];
        return test ? path.join(INU_SDK_ROOT, 'src', 'Userland', 'Tests', test) : undefined;
    }

    protected async materializeFeatureOwnedSource(projectDirectory: string, project: GeneratedProject): Promise<void> {
        const sourceRoot = this.featureSourceDirectoryForGeneratedProject(project);
        if (!sourceRoot) return;
        try {
            await fs.access(sourceRoot);
        } catch {
            throw new Error(`Selected Inu feature source is missing: ${sourceRoot} (required by ${project.id})`);
        }
        await this.copyManagedSourceFilesWithoutOverwriting(sourceRoot, projectDirectory);
    }

    protected async materializeSelectedUserlandSource(projectRoot: string, configuration: InuProjectConfiguration): Promise<void> {
        if (!configuration.userland) return;
        const settingsSource = path.join(INU_SDK_ROOT, 'src', 'Userland', 'Settings');
        const settingsDestination = path.join(projectRoot, 'Userland', 'Provided', 'Settings');
        await this.copyManagedSourceFilesWithoutOverwriting(settingsSource, settingsDestination);
    }

    protected async removeUnusedOptionalRoots(projectRoot: string): Promise<void> {
        // Boot, Kernel and Userland are permanent execution partitions in Kath&Inu.
        // Older top-level feature roots are removed only when empty.
        for (const name of ['Applications', 'Libraries', 'Services', 'Drivers', 'Tests', 'Configuration', 'System']) {
            const directory = path.join(projectRoot, name);
            try { const entries = await fs.readdir(directory); if (entries.length === 0) await fs.rmdir(directory); } catch { }
        }
    }

    protected managedSdkProjectsForGeneratedProject(project: GeneratedProject): string[] {
        const id = project.id.toLowerCase();
        if (id === 'kernel.core') return [];
        if (id.startsWith('architecture.')) return ['Inu.Arch.X64', 'Inu.Kernel.Platform.X64'];
        if (id.startsWith('boot.')) return ['Inu.Kernel.Console'];
        if (id.startsWith('memory.')) return ['Inu.Kernel.Memory', 'Inu.Kernel.VirtualMemory', 'Inu.Kernel.AddressSpace', 'Inu.Kernel.Heap'];
        if (id.startsWith('interrupts.')) return ['Inu.Kernel.InterruptDispatch', 'Inu.Kernel.InterruptBroker'];
        if (id.startsWith('scheduler.')) return ['Inu.Kernel.Scheduler'];
        if (id.startsWith('processes.')) return ['Inu.Kernel.Processes'];
        if (id.startsWith('syscalls.')) return ['Inu.Kernel.SystemCalls'];
        if (id === 'smp') return ['Inu.Kernel.Smp'];
        if (id.startsWith('timer.')) return ['Inu.Kernel.Time'];
        if (id === 'driver.pci') return ['Inu.Kernel.Pci'];
        if (id === 'driver.acpi') return ['Inu.Kernel.Acpi'];
        if (id === 'driver.serial-16550') return ['Inu.Kernel.Serial'];
        if (id === 'driver.virtio-console' || id === 'driver.virtio-rng') return ['Inu.Kernel.Virtio'];
        if (id === 'driver.usb-xhci') return ['Inu.Bus.Usb', 'Inu.Usb.Xhci'];
        if (id === 'driver.usb-ehci') return ['Inu.Bus.Usb'];
        if (id === 'storage.virtio-block') return ['Inu.Kernel.Storage', 'Inu.Kernel.Virtio'];
        if (id === 'storage.nvme') return ['Inu.Kernel.Storage', 'Inu.Kernel.Nvme'];
        if (id === 'storage.ahci') return ['Inu.Kernel.Storage', 'Inu.Kernel.Ahci'];
        if (id.startsWith('filesystem.')) return ['Inu.Filesystem.FatFs'];
        if (id.startsWith('networking.')) return ['Inu.Kernel.Networking'];
        if (id === 'networkdriver.virtio-net') return ['Inu.Kernel.Virtio'];
        if (id === 'networkdriver.e1000') return ['Inu.Kernel.E1000'];
        if (id === 'networkdriver.rtl8168') return ['Inu.Kernel.Rtl8168'];
        if (id.startsWith('input.ps2-')) return ['Inu.Kernel.Ps2'];
        if (id.startsWith('input.usb-hid-')) return ['Inu.Usb.Hid'];
        if (id === 'graphics.virtio-gpu') return ['Inu.Kernel.Graphics', 'Inu.Kernel.Virtio.Gpu'];
        if (id.startsWith('graphics.')) return ['Inu.Kernel.Graphics'];
        if (id.startsWith('audio.')) return ['Inu.Kernel.Audio'];
        if (id.startsWith('gui.')) return ['Inu.Kernel.Gui'];
        if (id.startsWith('userland.runtime')) return ['Userland'];
        return [];
    }

    protected componentRootsForGeneratedProject(project: GeneratedProject): string[] {
        const id = project.id.toLowerCase();
        const exact: Record<string, string[]> = {
            'scheduler.preemptive': ['Kernel.Scheduler.PriorityPolicy', 'Kernel.Threads.Lifecycle', 'Kernel.Threads.StateControl'],
            'scheduler.realtime': ['Kernel.Scheduler.PriorityPolicy', 'Kernel.Scheduler.LoadAwarePlacementPolicy', 'Kernel.Threads.Lifecycle', 'Kernel.Threads.StateControl'],
            'processes.kernel-threads': ['Kernel.Threads.Lifecycle', 'Kernel.Threads.StateControl'],
            'processes.processes': ['Kernel.Processes.Lifecycle', 'Kernel.Processes.Signals', 'Kernel.Processes.ForegroundControl'],
            'driver.pci': ['Kernel.Pci.ConfigurationRegistry', 'Kernel.Pci.EcamConfiguration', 'Kernel.Pci.LegacyConfiguration'],
            'driver.acpi': ['Kernel.Acpi.TableRegistry', 'Kernel.Acpi.MadtTopology', 'Kernel.Acpi.McfgDiscovery', 'Kernel.Acpi.HpetTable', 'Kernel.Acpi.FadtPlatform', 'Kernel.Acpi.EmbeddedController', 'Kernel.Acpi.Power'],
            'storage.nvme': ['Kernel.Storage.NvmeDriver'],
            'storage.ahci': ['Kernel.Storage.AhciDriver'],
            'filesystem.fatfs': ['Kernel.Filesystem.FatFs'],
            'filesystem.fat32': ['Kernel.Filesystem.FatFs'],
            'networkdriver.e1000': ['Kernel.Networking.E1000Driver'],
            'networkdriver.rtl8168': ['Kernel.Networking.Rtl8168Driver'],
            'input.usb-hid-keyboard': ['Kernel.Usb.HidKeyboard'],
            'input.usb-hid-mouse': ['Kernel.Usb.HidMouse'],
            'graphics.uefi-gop': ['Kernel.Graphics.FirmwareFramebuffer'],
            'graphics.generic-framebuffer': ['Kernel.Graphics.SimpleFramebuffer'],
            'timer.hpet': ['Kernel.Time.HpetClockSource'],
            'timer.tsc': ['Kernel.Time.InvariantTscClockSource'],
            'timer.local-apic': ['Kernel.Time.LocalApicInterruptTimer'],
            'timer.rtc': ['Kernel.Time.RtcCmosWallClockSource'],
            'networking.ipv4': ['Kernel.Networking.Ipv4Protocol', 'Kernel.Networking.ArpProtocol', 'Kernel.Networking.Icmpv4Protocol', 'Kernel.Networking.UdpIpv4Protocol', 'Kernel.Networking.DhcpCodec', 'Kernel.Networking.DnsCodec', 'Kernel.Networking.RouteManager', 'Kernel.Networking.SocketService'],
            'networking.dual-stack': ['Kernel.Networking.Ipv4Protocol', 'Kernel.Networking.ArpProtocol', 'Kernel.Networking.Icmpv4Protocol', 'Kernel.Networking.UdpIpv4Protocol', 'Kernel.Networking.Ipv6NdpProtocol', 'Kernel.Networking.DhcpCodec', 'Kernel.Networking.DnsCodec', 'Kernel.Networking.RouteManager', 'Kernel.Networking.SocketService']
        };
        if (exact[id]) return exact[id];
        if (id === 'boot.uefi') return ['Boot.Context.Core', 'Boot.FramebufferInfo', 'Boot.MemoryMapBuffer', 'Boot.MemoryDescriptorLayout', 'Boot.PageTableWorkspace', 'Boot.AcpiRootPointer', 'Boot.ApplicationProcessorTrampoline', 'Boot.SystemAssetBundle', 'Boot.KernelImageBase'];
        return [];
    }

    protected async readComponentDefinition(id: string): Promise<InuSourceComponentDefinition | undefined> {
        const definitionPath = path.join(INU_SDK_ROOT, 'components', 'definitions', `${id}.json`);
        try {
            return JSON.parse(await fs.readFile(definitionPath, 'utf8')) as InuSourceComponentDefinition;
        } catch {
            return undefined;
        }
    }

    protected legacyProjectsForMissingComponent(id: string): string[] {
        const map: Record<string, string[]> = {
            'Kernel.Storage': ['Inu.Kernel.Storage'],
            'Kernel.Usb.Bus': ['Inu.Bus.Usb'],
            'Kernel.Input.Ps2': ['Inu.Kernel.Ps2'],
            'Kernel.Networking': ['Inu.Kernel.Networking'],
            'Kernel.Time': ['Inu.Kernel.Time'],
            'Kernel.Graphics': ['Inu.Kernel.Graphics']
        };
        return map[id] ?? [];
    }

    protected async componentClosure(rootIds: readonly string[]): Promise<{ components: InuSourceComponentDefinition[]; legacyProjects: string[] }> {
        const components: InuSourceComponentDefinition[] = [];
        const legacyProjects = new Set<string>();
        const visited = new Set<string>();
        const visit = async (id: string): Promise<void> => {
            if (visited.has(id)) return;
            visited.add(id);
            const definition = await this.readComponentDefinition(id);
            if (!definition) {
                for (const project of this.legacyProjectsForMissingComponent(id)) legacyProjects.add(project);
                return;
            }
            const implementation = definition.implementations?.CSharp;
            if (implementation?.status !== 'available') return;
            for (const dependency of definition.dependencies ?? []) await visit(dependency);
            components.push(definition);
        };
        for (const id of rootIds) await visit(id);
        return { components, legacyProjects: Array.from(legacyProjects).sort((a, b) => a.localeCompare(b)) };
    }

    protected async copyComponentSourceFile(sourceRelativePath: string, destinationRoot: string, componentId: string, rootComponent: boolean): Promise<void> {
        const source = path.join(INU_SDK_ROOT, ...sourceRelativePath.split('/'));
        try { await fs.access(source); } catch { throw new Error(`Inu component ${componentId} declares missing source: ${sourceRelativePath}`); }
        const fileName = path.basename(sourceRelativePath);
        const destination = rootComponent
            ? path.join(destinationRoot, fileName)
            : path.join(destinationRoot, 'Dependencies', this.safeSegment(componentId), fileName);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        try { await fs.access(destination); } catch { await fs.copyFile(source, destination); }
    }

    protected async materializeGeneratedProjectSource(_projectRoot: string, projectDirectory: string, project: GeneratedProject, _configuration: InuProjectConfiguration): Promise<void> {
        // One canonical kernel source plan owns all kernel-side copies and dependencies.
        // Per-node copying duplicated shared USB/graphics files in the same assembly.
        if (project.kind === 'kernel' || project.kind === 'kernel-module') return;
        const rootIds = this.componentRootsForGeneratedProject(project);
        if (rootIds.length === 0) {
            // Compatibility fallback for SDK areas not yet decomposed into source components.
            // This is intentionally local to that selected feature; Kath no longer copies the
            // entire project dependency closure into System/SDK/src.
            for (const sdkProject of this.managedSdkProjectsForGeneratedProject(project)) {
                const sourceRoot = path.join(INU_SDK_ROOT, 'src', sdkProject);
                const destinationRoot = path.join(projectDirectory, sdkProject);
                try { await fs.access(sourceRoot); } catch { throw new Error(`Selected Inu source project is missing: ${sdkProject} (required by ${project.id})`); }
                await this.copyManagedSourceFilesWithoutOverwriting(sourceRoot, destinationRoot);
            }
            return;
        }

        const closure = await this.componentClosure(rootIds);
        const roots = new Set(rootIds);
        const copied = new Set<string>();
        for (const component of closure.components) {
            const implementation = component.implementations?.CSharp;
            if (!implementation) continue;
            const isRoot = roots.has(component.id);
            for (const source of implementation.sources) {
                const key = source.toLowerCase();
                if (copied.has(key)) continue;
                copied.add(key);
                await this.copyComponentSourceFile(source, projectDirectory, component.id, isRoot);
            }
        }
        for (const sdkProject of closure.legacyProjects) {
            const destination = path.join(projectDirectory, 'Dependencies', sdkProject);
            await this.copyManagedSourceFilesWithoutOverwriting(path.join(INU_SDK_ROOT, 'src', sdkProject), destination);
        }
    }

    protected async copyManagedSourceFilesWithoutOverwriting(source: string, destination: string): Promise<void> {
        const entries = await fs.readdir(source, { withFileTypes: true });
        await fs.mkdir(destination, { recursive: true });
        for (const entry of entries) {
            if (entry.name === 'bin' || entry.name === 'obj' || entry.name === '.vs') continue;
            const from = path.join(source, entry.name);
            const to = path.join(destination, entry.name);
            if (entry.isDirectory()) {
                await this.copyManagedSourceFilesWithoutOverwriting(from, to);
            } else if (entry.isFile() && entry.name.endsWith('.cs')) {
                try { await fs.access(to); } catch { await fs.copyFile(from, to); }
            }
        }
    }

    protected async csProject(projectRoot: string, projectDirectory: string, configuration: InuProjectConfiguration, project: GeneratedProject): Promise<string> {
        const outputType = project.kind === 'test' ? 'Exe' : 'Library';
        const localSdkSource = path.relative(projectDirectory, path.join(projectRoot, 'Kernel', 'Provided', 'SDK', 'src')).replace(/\\/g, '/');
        const dependencies = new Set<string>();
        const referencePattern = /<ProjectReference\s+Include="([^"]+)"/g;
        for (const sdkProject of this.managedSdkProjectsForGeneratedProject(project)) {
            const sdkProjectDirectory = path.join(INU_SDK_ROOT, 'src', sdkProject);
            let projectFiles: string[] = [];
            try { projectFiles = (await fs.readdir(sdkProjectDirectory)).filter(name => name.endsWith('.csproj')); } catch { /* reported by source materialization */ }
            for (const projectFile of projectFiles) {
                const text = await fs.readFile(path.join(sdkProjectDirectory, projectFile), 'utf8');
                for (const match of text.matchAll(referencePattern)) {
                    const dependency = this.sdkProjectNameFromInclude(match[1], sdkProjectDirectory);
                    if (dependency && !this.managedSdkProjectsForGeneratedProject(project).includes(dependency)) dependencies.add(dependency);
                }
            }
        }
        const references = Array.from(dependencies).sort((a, b) => a.localeCompare(b)).map(dependency =>
            `    <ProjectReference Include="${localSdkSource}/${dependency}/${dependency}.csproj" />`
        );
        return [
            '<Project Sdk="Microsoft.NET.Sdk">',
            '  <PropertyGroup>',
            '    <TargetFramework>net10.0</TargetFramework>',
            `    <OutputType>${outputType}</OutputType>`,
            '    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>',
            '    <ImplicitUsings>disable</ImplicitUsings>',
            '    <Nullable>disable</Nullable>',
            '    <DisableImplicitFrameworkReferences>true</DisableImplicitFrameworkReferences>',
            '    <NoStdLib>true</NoStdLib>',
            '    <NoConfig>true</NoConfig>',
            '    <RuntimeMetadataVersion>v4.0.30319</RuntimeMetadataVersion>',
            '    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>',
            '    <GenerateTargetFrameworkAttribute>false</GenerateTargetFrameworkAttribute>',
            '    <DisableTransitiveProjectReferences>true</DisableTransitiveProjectReferences>',
            `    <AssemblyName>${this.safeSegment(configuration.name)}.${this.safeSegment(project.id)}</AssemblyName>`,
            `    <RootNamespace>${this.namespace(configuration.name)}.${this.namespace(project.id)}</RootNamespace>`,
            '  </PropertyGroup>',
            ...(references.length ? ['  <ItemGroup>', ...references, '  </ItemGroup>'] : []),
            '</Project>',
            ''
        ].join('\n');
    }

    protected configurationJson(configuration: InuProjectConfiguration): string {
        return JSON.stringify({
            ...configuration,
            schemaVersion: 8,
            product: 'Kath&Inu',
            ideVersion: KATH_VERSION,
            sdk: {
                root: INU_SDK_ROOT,
                buildEntryPoint: 'Build-Inu.bat',
                runEntryPoint: 'Build-Inu.bat',
                runOperation: 'Run'
            }
        }, null, 2) + '\n';
    }

    protected projectGraphJson(configuration: InuProjectConfiguration, projects: GeneratedProject[]): string {
        return JSON.stringify({
            schemaVersion: 2,
            generatedBy: `Kath&Inu ${KATH_VERSION}`,
            sourcePartitions: ['Boot','Kernel','Userland'],
            sourceRoles: ['Provided', configuration.name],
            kernelArchitecture: configuration.kernelArchitecture,
            projects
        }, null, 2) + '\n';
    }

    protected generatedConfigurationSource(configuration: InuProjectConfiguration): string {
        const strings = (values: string[]) => values.length === 0 ? 'global::System.Array.Empty<string>()' : `new string[] { ${values.map(value => JSON.stringify(value)).join(', ')} }`;
        const roleSetup = this.cpuRoleSetupSource(configuration);
        return `// <auto-generated />\nusing Inu.Kernel.Processes;\nusing Inu.Kernel.Smp;\n\nnamespace Inu.Kernel.Bootstrap;\n\npublic static class GeneratedConfiguration\n{\n    public const string OperatingSystemName = ${JSON.stringify(configuration.name)};\n    public const string CopyrightOwner = ${JSON.stringify((configuration.author || '').trim() || 'The DCL Group')};\n    public const string KernelArchitecture = ${JSON.stringify(configuration.kernelArchitecture)};\n    public const string TargetArchitecture = ${JSON.stringify(configuration.targetArchitecture)};\n    public const string BootArchitecture = ${JSON.stringify(configuration.bootArchitecture)};\n    public const string MemorySystem = ${JSON.stringify(configuration.memorySystem)};\n    public const string Scheduler = ${JSON.stringify(configuration.scheduler)};\n    public const string ProcessSupport = ${JSON.stringify(configuration.processSupport)};\n    public const string SyscallModel = ${JSON.stringify(configuration.syscallModel)};\n    public const bool Smp = ${configuration.smp ? 'true' : 'false'};\n    public const uint QemuCpuCount = ${configuration.qemuCpuCount}U;\n    public const string CpuRoleKernel = ${JSON.stringify(configuration.cpuRoles.kernel)};\n    public const string CpuRoleUserland = ${JSON.stringify(configuration.cpuRoles.userland)};\n    public const string CpuRoleGui = ${JSON.stringify(configuration.cpuRoles.gui)};\n    public const string CpuRoleDrivers = ${JSON.stringify(configuration.cpuRoles.drivers)};\n    public const string CpuRoleInterrupts = ${JSON.stringify(configuration.cpuRoles.interrupts)};\n    public const string CpuRoleNetworking = ${JSON.stringify(configuration.cpuRoles.networking)};\n    public const string CpuRoleStorage = ${JSON.stringify(configuration.cpuRoles.storage)};\n    public const string CpuRoleRealtime = ${JSON.stringify(configuration.cpuRoles.realtime)};\n    public const string CpuRoleBackground = ${JSON.stringify(configuration.cpuRoles.background)};\n    public const string InterruptModel = ${JSON.stringify(configuration.interruptModel)};\n    public const string Filesystem = ${JSON.stringify(configuration.filesystem)};\n    public const string NetworkStack = ${JSON.stringify(configuration.networkStack)};\n    public const string Audio = ${JSON.stringify(configuration.audio)};\n    public const bool Userland = ${configuration.userland ? 'true' : 'false'};\n    public const string Shell = ${JSON.stringify(configuration.shell)};\n    public const string Gui = ${JSON.stringify(configuration.gui)};\n    public const string GuiDesktopPath = ${JSON.stringify(configuration.guiDesktopPath)};\n    public const string GuiLoginPath = ${JSON.stringify(configuration.guiLoginPath)};\n    public const string Virtualisation = ${JSON.stringify(configuration.virtualisation)};\n    public const string SafetyProfile = ${JSON.stringify(configuration.safetyProfile)};\n\n#if DEBUG\n    public const bool DebugBuild = true;\n#else\n    public const bool DebugBuild = false;\n#endif\n    public const bool DebuggingConfigured = ${configuration.debugging.length > 0 ? 'true' : 'false'};\n    public static bool DebuggingEnabled() => DebugBuild && DebuggingConfigured;\n    public static string[] EffectiveDebugging() => DebuggingEnabled() ? Debugging() : global::System.Array.Empty<string>();\n\n    public static bool ApplyCpuRoles()
    {
${roleSetup}
        if (!KernelProcesses.ConfigureUserlandRuntime(true)) return false;
        if (!KernelProcesses.ConfigureGraphicalSessionPaths(GuiDesktopPath, GuiLoginPath)) return false;
        return true;
    }

    public static string[] Timers() => ${strings(configuration.timers)};\n    public static string[] Drivers() => ${strings(configuration.drivers)};\n    public static string[] StorageControllers() => ${strings(configuration.storageControllers)};\n    public static string[] NetworkDrivers() => ${strings(configuration.networkDrivers)};\n    public static string[] Input() => ${strings(configuration.input)};\n    public static string[] Graphics() => ${strings(configuration.graphics)};\n    public static string[] Debugging() => ${strings(configuration.debugging)};\n    public static string[] Testing() => ${strings(configuration.testing)};\n    public static string[] SafetyOptions() => ${strings(configuration.safetyOptions)};\n}\n`;
    }

    protected kernelSource(configuration: InuProjectConfiguration): string {
        if (configuration.kernelArchitecture === 'microkernel') return this.microkernelKernelSource(configuration);
        if (configuration.kernelArchitecture === 'monolithic') return this.monolithicKernelSource(configuration);
        return this.hybridKernelSource(configuration);
    }

    protected virtioGpuConsoleBridgeSource(): string {
        return `    private static KernelGraphicsDisplayHandle _consoleGraphicsDisplay;

    private static Boolean TryUseVirtioGpuConsole()
    {
        if (!KernelConsole.IsInitialized() || !KernelGraphics.IsInitialized()) return false;
        KernelGraphicsCapabilities capabilities = KernelGraphics.GetCapabilities();
        Boolean havePrevious = KernelGraphics.TryGetPrimaryDisplay(out KernelGraphicsDisplayInfo previous);
        KernelGraphicsDisplayInfo selected = default;
        Boolean found = false;
        for (UInt32 i = 0U; i < capabilities.Displays; i++)
        {
            if (!KernelGraphics.TryGetDisplay(i, out KernelGraphicsDisplayInfo candidate) || candidate.Kind != KernelGraphicsTargetKind.VirtioGpu) continue;
            selected = candidate; found = true; break;
        }
        if (!found || !TryGetConsolePixelFormat(selected.Framebuffer.Mode.PixelFormat, out UInt32 pixelFormat)) return false;
        // Prove the virtqueue + host transfer path works before changing the visible console.
        if (!KernelGraphics.Present(selected.Handle, 0U, 0U, 1U, 1U)) return false;
        KernelGraphicsDisplayHandle oldConsoleDisplay = _consoleGraphicsDisplay;
        _consoleGraphicsDisplay = selected.Handle;
        KernelGraphicsFramebuffer framebuffer = selected.Framebuffer;
        if (!KernelConsole.ReconfigureFramebuffer(framebuffer.VirtualAddress, framebuffer.ByteLength, framebuffer.Mode.Width, framebuffer.Mode.Height, framebuffer.Mode.PixelsPerScanLine, pixelFormat, &PresentConsoleGraphics))
        {
            _consoleGraphicsDisplay = oldConsoleDisplay;
            RestorePreviousGraphicsDisplay(havePrevious, previous);
            return false;
        }
        // ReconfigureFramebuffer redraws the retained console into the VirtIO backing store, but
        // the driver deliberately defers SET_SCANOUT until ActivateDisplay. Generated kernels must
        // perform that activation just like the canonical Bootstrap/HAL; otherwise virtio-vga can
        // leave the firmware surface while no Inu resource has ever been bound to the scanout.
        if (!KernelVirtioGpu.ActivateDisplay(selected.Handle))
        {
            _consoleGraphicsDisplay = oldConsoleDisplay;
            RestorePreviousGraphicsDisplay(havePrevious, previous);
            return false;
        }
        if (!KernelGraphics.SetPrimaryDisplay(selected.Handle))
        {
            _consoleGraphicsDisplay = oldConsoleDisplay;
            RestorePreviousGraphicsDisplay(havePrevious, previous);
            return false;
        }
        EnsurePreferredFramebufferBuffers();
        return true;
    }

    private static void EnsurePreferredFramebufferBuffers()
    {
        FramebufferBufferCapabilities buffers = KernelConsole.GetFramebufferBufferCapabilities();
        if (buffers.AvailableBufferCount >= 3U) return;
        UInt64 bytes = KernelConsole.GetFramebufferBufferByteCount();
        if (bytes == 0UL || !KernelHeap.TryAllocate(bytes, 4096UL, true, out KernelHeapAllocation a)) return;
        if (!KernelHeap.TryAllocate(bytes, 4096UL, true, out KernelHeapAllocation b)) { KernelHeap.TryRelease(a); return; }
        if (!KernelConsole.ConfigureFramebufferBuffers(a.Address, b.Address, bytes)) { KernelHeap.TryRelease(a); KernelHeap.TryRelease(b); }
    }

    private static Boolean PresentConsoleGraphics(UInt32 x, UInt32 y, UInt32 width, UInt32 height)
    { return _consoleGraphicsDisplay.Value != 0U && KernelGraphics.Present(_consoleGraphicsDisplay, x, y, width, height); }

    private static Boolean TryGetConsolePixelFormat(KernelGraphicsPixelFormat pixelFormat, out UInt32 consolePixelFormat)
    {
        consolePixelFormat = 0U;
        if (pixelFormat == KernelGraphicsPixelFormat.RedGreenBlueReserved8) return true;
        if (pixelFormat == KernelGraphicsPixelFormat.BlueGreenRedReserved8) { consolePixelFormat = 1U; return true; }
        return false;
    }

    private static void RestorePreviousGraphicsDisplay(Boolean havePrevious, KernelGraphicsDisplayInfo previous)
    {
        if (!havePrevious) return;
        KernelGraphics.SetPrimaryDisplay(previous.Handle);
        _consoleGraphicsDisplay = previous.Handle;
        if (!TryGetConsolePixelFormat(previous.Framebuffer.Mode.PixelFormat, out UInt32 pixelFormat)) return;
        KernelGraphicsFramebuffer framebuffer = previous.Framebuffer;
        KernelConsole.ReconfigureFramebuffer(framebuffer.VirtualAddress, framebuffer.ByteLength, framebuffer.Mode.Width, framebuffer.Mode.Height, framebuffer.Mode.PixelsPerScanLine, pixelFormat, &PresentConsoleGraphics);
    }

    private static Boolean HasVirtioGpuPciDevice()
    {
        if (!KernelPci.IsInitialized()) return false;
        UInt32 count = KernelPci.GetDeviceCount();
        for (UInt32 i = 0U; i < count; i++)
        {
            if (!KernelPci.TryGetDevice(i, out PciDeviceInfo device)) continue;
            if (device.VendorId == 0x1AF4U && (device.DeviceId == 0x1050U || (device.DeviceId == 0x1010U && device.SubsystemId == 16U))) return true;
        }
        return false;
    }
`;
    }

    protected microkernelKernelSource(configuration: InuProjectConfiguration): string {
        return `using System;
using Inu.Kernel.Bootstrap.Boot;
using Inu.Kernel.Bootstrap.Startup;
using Inu.Kernel.Bootstrap.HAL;
using Inu.Kernel.Console;
namespace Inu.Kernel.Bootstrap;

/// <summary>Minimal-privilege microkernel: mechanisms stay in kernel; device and high-level services live outside it.</summary>
public static unsafe class Kernel
{
    public static Boolean KMain<TBoot>(TBoot boot)
        where TBoot : IFinalMemoryMapBufferContext, IMemoryDescriptorLayoutContext, IBootstrapPageTableWorkspaceContext, IAcpiRootPointerContext, IApplicationProcessorTrampolineContext, ISystemAssetBundleContext, IKernelImageContext, IBootFramebufferContext
    {
        global::KathInu.${this.namespace(configuration.name)}.Boot.Boot.Configure();
        if (!BootDiagnosticsStartup.Initialize(boot)) return false;
        if (!PlatformTablesStartup.Initialize()) return false;
        if (!AcpiStartup.Initialize(boot)) return false;
        if (!TimeStartup.Initialize()) return false;
        if (!MemoryRuntimeStartup.Initialize(boot)) return false;
        if (!GraphicsStartup.Initialize(boot)) return false;
        if (!SmpStartup.Initialize(boot)) return false;
        if (!SchedulerRuntimeStartup.Initialize()) return false;
        if (!ProtectionStartup.Initialize()) return false;
        if (!ProcessRuntimeStartup.Initialize()) return false;
        if (!TimerDispatchStartup.Initialize()) return false;
        if (!BootstrapGraphicsTransportStartup.Initialize()) return false;
        if (!KernelStructuredLogging.InfoLine("microkernel", "Kernel.KMain", "Selected microkernel mechanisms are online; higher services remain outside the kernel.")) return false;
        if (!UserlandCommandStartup.Initialize(boot)) return false;
        if (!InterruptRuntimeStartup.Enable()) return false;
        return global::KathInu.${this.namespace(configuration.name)}.Kernel.Kernel.Start();
    }

}
`;
    }

    protected hybridKernelSource(configuration: InuProjectConfiguration): string {
        return `using System;
using Inu.Kernel.Bootstrap.Boot;
using Inu.Kernel.Bootstrap.Startup;
using Inu.Kernel.Bootstrap.HAL;
using Inu.Kernel.Console;
namespace Inu.Kernel.Bootstrap;

/// <summary>Hybrid kernel: core mechanisms and latency-sensitive driver/input facilities stay kernel-resident.</summary>
public static unsafe class Kernel
{
    public static Boolean KMain<TBoot>(TBoot boot)
        where TBoot : IFinalMemoryMapBufferContext, IMemoryDescriptorLayoutContext, IBootstrapPageTableWorkspaceContext, IAcpiRootPointerContext, IApplicationProcessorTrampolineContext, ISystemAssetBundleContext, IKernelImageContext, IBootFramebufferContext
    {
        global::KathInu.${this.namespace(configuration.name)}.Boot.Boot.Configure();
        if (!BootDiagnosticsStartup.Initialize(boot)) return false;
        if (!PlatformTablesStartup.Initialize()) return false;
        if (!AcpiStartup.Initialize(boot)) return false;
        if (!TimeStartup.Initialize()) return false;
        if (!MemoryRuntimeStartup.Initialize(boot)) return false;
        if (!GraphicsStartup.Initialize(boot)) return false;
        if (!SmpStartup.Initialize(boot)) return false;
        if (!SchedulerRuntimeStartup.Initialize()) return false;
        if (!ProtectionStartup.Initialize()) return false;
        if (!ProcessRuntimeStartup.Initialize()) return false;
        if (!TimerDispatchStartup.Initialize()) return false;
        if (!InputHardwareStartup.Initialize()) return false;
        if (!DriverInfrastructureStartup.Initialize()) return false;
        if (!InputHardwareStartup.EnableHardwareInterrupts()) return false;
        if (!GraphicsHardwareStartup.Initialize()) return false;
        if (!DriverBindingStartup.Initialize()) return false;
        if (!KernelStructuredLogging.InfoLine("hybrid", "Kernel.KMain", "The OS-selected kernel-resident hardware components are online.")) return false;
        if (!UserlandCommandStartup.Initialize(boot)) return false;
        if (!InterruptRuntimeStartup.Enable()) return false;
        return global::KathInu.${this.namespace(configuration.name)}.Kernel.Kernel.Start();
    }

}
`;
    }

    protected monolithicKernelSource(configuration: InuProjectConfiguration): string {
        return `using System;
using Inu.Kernel.Bootstrap.Boot;
using Inu.Kernel.Bootstrap.Startup;
using Inu.Kernel.Bootstrap.HAL;
using Inu.Kernel.Console;
namespace Inu.Kernel.Bootstrap;

/// <summary>Monolithic kernel: every configured kernel facility is initialized directly in one privileged runtime.</summary>
public static unsafe class Kernel
{
    public static Boolean KMain<TBoot>(TBoot boot)
        where TBoot : IFinalMemoryMapBufferContext, IMemoryDescriptorLayoutContext, IBootstrapPageTableWorkspaceContext, IAcpiRootPointerContext, IApplicationProcessorTrampolineContext, ISystemAssetBundleContext, IKernelImageContext, IBootFramebufferContext
    {
        global::KathInu.${this.namespace(configuration.name)}.Boot.Boot.Configure();
        if (!BootDiagnosticsStartup.Initialize(boot)) return false;
        if (!PlatformTablesStartup.Initialize()) return false;
        if (!AcpiStartup.Initialize(boot)) return false;
        if (!TimeStartup.Initialize()) return false;
        if (!MemoryRuntimeStartup.Initialize(boot)) return false;
        if (!GraphicsStartup.Initialize(boot)) return false;
        if (!SmpStartup.Initialize(boot)) return false;
        if (!SchedulerRuntimeStartup.Initialize()) return false;
        if (!ProtectionStartup.Initialize()) return false;
        if (!ProcessRuntimeStartup.Initialize()) return false;
        if (!TimerDispatchStartup.Initialize()) return false;
        if (!InputHardwareStartup.Initialize()) return false;
        if (!DriverInfrastructureStartup.Initialize()) return false;
        if (!InputHardwareStartup.EnableHardwareInterrupts()) return false;
        if (!GraphicsHardwareStartup.Initialize()) return false;
        if (!StorageHardwareStartup.Initialize()) return false;
        if (!NetworkingHardwareStartup.Initialize()) return false;
        if (!UsbHardwareStartup.Initialize()) return false;
        if (!DriverBindingStartup.Initialize()) return false;
        if (!KernelStructuredLogging.InfoLine("monolithic", "Kernel.KMain", "The OS-selected kernel-resident components are online.")) return false;
        if (!UserlandCommandStartup.Initialize(boot)) return false;
        if (!InterruptRuntimeStartup.Enable()) return false;
        return global::KathInu.${this.namespace(configuration.name)}.Kernel.Kernel.Start();
    }

}
`;
    }

    protected sdkKernelModel(configuration: InuProjectConfiguration): 'Monolithic' | 'Microkernel' | 'Hybrid' | 'Custom' {
        return configuration.kernelArchitecture === 'microkernel' ? 'Microkernel'
            : configuration.kernelArchitecture === 'hybrid' ? 'Hybrid'
            : configuration.kernelArchitecture === 'custom' ? 'Custom'
            : 'Monolithic';
    }

    protected sdkConfigurationJson(configuration: InuProjectConfiguration): string {
        return JSON.stringify({
            Version: 3,
            Completed: true,
            Name: configuration.name,
            Author: (configuration.author || '').trim() || 'The DCL Group',
            Architecture: configuration.targetArchitecture === 'x86_64' ? 'x64' : configuration.targetArchitecture,
            KernelModel: this.sdkKernelModel(configuration),
            BootProtocol: configuration.bootArchitecture === 'uefi' ? 'Uefi' : configuration.bootArchitecture,
            // The IDE configuration describes supplied/generated components directly rather than
            // Visual Studio's "development areas" inversion. Keep this empty and let the explicit
            // MSBuild execution-domain properties below be authoritative for kernel inclusion.
            WorkAreas: [],
            CpuRoles: configuration.cpuRoles,
            QemuCpuCount: configuration.qemuCpuCount
        }, null, 2) + '\n';
    }

    protected sdkKernelAreas(configuration: InuProjectConfiguration): Record<string, boolean> {
        const model = this.sdkKernelModel(configuration);
        const monolithic = model === 'Monolithic';
        const hybrid = model === 'Hybrid';
        const custom = model === 'Custom';
        const customKernelHardware = custom && configuration.hardwareSupport.some(value => this.customExecutionArea(configuration, `hardware:${value}`) === 'kernel');
        return {
            Shell: false,
            GUI: false,
            Drivers: monolithic || hybrid || customKernelHardware,
            HAL: true,
            Audio: false,
            Filesystems: (monolithic || (custom && this.customExecutionArea(configuration, 'service:filesystem') === 'kernel')) && configuration.filesystem !== 'none',
            Storage: (monolithic || (custom && configuration.storageControllers.some(value => this.customExecutionArea(configuration, `hardware:${value}`) === 'kernel'))) && configuration.storageControllers.length > 0,
            Networking: (monolithic || (custom && this.customExecutionArea(configuration, 'service:networking') === 'kernel')) && configuration.networkStack !== 'none',
            // Inu's currently implemented PS/2 and USB HID providers are kernel mechanisms.
            // When the OS author selects them, materialize those mechanisms even for a microkernel
            // GUI so the ring-3 desktop/login can receive real input events. Kath may move a future
            // userland-capable provider out of the kernel without changing the GUI contract.
            USB: (monolithic && configuration.drivers.some(value => value.startsWith('usb-'))) || configuration.input.some(value => value.startsWith('usb-hid-')),
            Input: monolithic || hybrid || configuration.input.length > 0,
            Processes: true,
            Scheduler: configuration.scheduler !== 'none',
            SystemCalls: true,
            Security: true,
            Diagnostics: configuration.debugging.length > 0,
            Tests: false
        };
    }

    protected sdkConfigurationProps(configuration: InuProjectConfiguration): string {
        const model = this.sdkKernelModel(configuration);
        const architecture = configuration.targetArchitecture === 'x86_64' ? 'x64' : configuration.targetArchitecture;
        const boot = configuration.bootArchitecture === 'uefi' ? 'Uefi' : configuration.bootArchitecture;
        const areas = this.sdkKernelAreas(configuration);
        const names = Object.keys(areas);
        const constants = [
            `INU_ARCH_${architecture.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
            `INU_KERNEL_${model.toUpperCase()}`,
            ...names.filter(name => areas[name]).map(name => `INU_WORKAREA_${name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`),
            ...names.filter(name => areas[name]).map(name => `INU_KERNELAREA_${name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`),
                        ...(areas.Processes ? ['INU_COMPONENT_PROCESS_LIFECYCLE', 'INU_COMPONENT_PROCESS_ADDRESS_SPACE_OWNERSHIP', 'INU_COMPONENT_PROCESS_FOREGROUND_CONTROL', 'INU_COMPONENT_PROCESS_SIGNALS'] : []),
            ...(areas.Scheduler ? ['INU_COMPONENT_SCHEDULER_PRIORITY_POLICY', 'INU_COMPONENT_SCHEDULER_LOAD_AWARE_PLACEMENT'] : []),
...(areas.Networking ? ['INU_COMPONENT_NETWORK_ROUTE_MANAGER', 'INU_COMPONENT_NETWORK_NEIGHBOR_CACHE', 'INU_COMPONENT_NETWORK_SOCKET_SERVICE', 'INU_COMPONENT_NETWORK_DHCP_CODEC', 'INU_COMPONENT_NETWORK_DNS_CODEC', 'INU_COMPONENT_NETWORK_ARP_PROTOCOL', 'INU_COMPONENT_NETWORK_IPV4_PROTOCOL', 'INU_COMPONENT_NETWORK_ICMPV4_PROTOCOL', 'INU_COMPONENT_NETWORK_UDP_IPV4_PROTOCOL', 'INU_COMPONENT_NETWORK_TCP_OBSERVATION_PROTOCOL', 'INU_COMPONENT_NETWORK_IPV6_NDP_PROTOCOL'] : []),
            ...(areas.USB ? ['INU_COMPONENT_USB_ENUMERATION', 'INU_COMPONENT_USB_HID_KEYBOARD', 'INU_COMPONENT_USB_HID_MOUSE', 'INU_COMPONENT_USB_MASS_STORAGE'] : []),
            ...(areas.Storage ? ['INU_COMPONENT_STORAGE_PARTITION_DISCOVERY'] : []),
            ...(areas.Input ? ['INU_COMPONENT_INPUT_KEYBOARD_DECODER'] : []),
            ...(areas.Drivers ? ['INU_COMPONENT_INTERRUPTS_AFFINITY_RESOLVER', 'INU_COMPONENT_INTERRUPTS_IO_APIC_ROUTER', 'INU_COMPONENT_INTERRUPTS_PCI_MESSAGE_ROUTER', 'INU_COMPONENT_PCI_LEGACY_CONFIGURATION', 'INU_COMPONENT_PCI_ECAM_CONFIGURATION', 'INU_COMPONENT_ACPI_MCFG', 'INU_COMPONENT_ACPI_EMBEDDED_CONTROLLER'] : []),
            ...(areas.HAL ? ['INU_COMPONENT_TIME_HPET_CLOCK_SOURCE', 'INU_COMPONENT_TIME_INVARIANT_TSC_CLOCK_SOURCE', 'INU_COMPONENT_TIME_RTC_CMOS_WALL_CLOCK', 'INU_COMPONENT_TIME_LOCAL_APIC_INTERRUPT_TIMER', 'INU_COMPONENT_ACPI_MADT', 'INU_COMPONENT_ACPI_HPET_TABLE', 'INU_COMPONENT_ACPI_FADT', 'INU_COMPONENT_ACPI_POWER'] : []),
            ...(configuration.bootArchitecture === 'uefi' ? ['INU_COMPONENT_GRAPHICS_FIRMWARE_FRAMEBUFFER'] : [])
        ];
        const defaultDomain = model === 'Microkernel' ? 'Userland' : model === 'Hybrid' ? 'Mixed' : model === 'Custom' ? 'Custom' : 'Kernel';
        const propertyLines = names.map(name => `    <InuKernelArea${name.replace(/[^A-Za-z0-9]/g, '')}>${areas[name] ? 'true' : 'false'}</InuKernelArea${name.replace(/[^A-Za-z0-9]/g, '')}>`);
        return [
            '<Project>',
            '  <!-- Generated from IDE-authoritative Inu.json. Do not hand-edit. -->',
            '  <PropertyGroup>',
            '    <InuSdkRoot Condition="\'$(InuSdkRoot)\' == \'\' And \'$(INU_SDK_ROOT)\' != \'\'">$(INU_SDK_ROOT)</InuSdkRoot>',
            '    <InuSdkRoot Condition="\'$(InuSdkRoot)\' == \'\'">C:\\Inu</InuSdkRoot>',
            '    <InuConfigurationVersion>3</InuConfigurationVersion>',
            `    <InuTargetArchitecture>${architecture}</InuTargetArchitecture>`,
            `    <InuKernelModel>${model}</InuKernelModel>`,
            `    <InuBootProtocol>${boot}</InuBootProtocol>`,
            `    <InuQemuCpuCount>${configuration.qemuCpuCount}</InuQemuCpuCount>`,
            '    <InuConfigurationCompleted>true</InuConfigurationCompleted>',
            `    <InuDefaultExecutionDomain>${defaultDomain}</InuDefaultExecutionDomain>`,
            ...propertyLines,
            `    <DefineConstants>$(DefineConstants);${constants.join(';')}</DefineConstants>`,
            '  </PropertyGroup>',
            '</Project>',
            ''
        ].join('\n');
    }

    protected sdkConfigurationTargets(configuration: InuProjectConfiguration): string {
        // The IDE project graph describes service/driver/userland projects. The freestanding kernel
        // project links only SDK kernel modules selected by Inu.Configuration.props; generated
        // workspace placeholders must never be pulled into the NativeAOT kernel accidentally.
        return [
            '<Project>',
            '  <!-- IDE workspace topology is recorded in Inu.ProjectGraph.json. -->',
            '  <ItemGroup />',
            '</Project>',
            ''
        ].join('\n');
    }

    protected sdkProjectManifest(configuration: InuProjectConfiguration): string {
        const targetArchitecture = configuration.targetArchitecture === 'x86_64' ? 'x64' : configuration.targetArchitecture;
        const bootProtocol = configuration.bootArchitecture === 'uefi' ? 'Uefi' : configuration.bootArchitecture;
        return JSON.stringify({
            Name: configuration.name,
            Author: (configuration.author || '').trim() || 'The DCL Group',
            ProjectFile: 'InuKernel.csproj',
            TargetArchitecture: targetArchitecture,
            BootProtocol: bootProtocol,
            KernelModel: this.sdkKernelModel(configuration),
            ConfigurationFile: 'Inu.Configuration.json',
            ConfigurationProps: 'Inu.Configuration.props',
            ConfigurationTargets: 'Inu.Configuration.targets',
            KernelEntry: 'KMain',
            RuntimePack: 'Inu.RuntimePack.X64.Bootstrap',
            OutputDirectory: 'Artifacts',
            QemuCpuCount: configuration.qemuCpuCount,
            Debugging: {
                EnableOnlyInDebugConfiguration: true,
                ConfiguredFeatures: [...configuration.debugging]
            }
        }, null, 2) + '\n';
    }

    protected managedProjectConditionEnabled(condition: string | undefined, configuration: InuProjectConfiguration): boolean {
        if (!condition || !condition.trim()) return true;
        const areas = this.sdkKernelAreas(configuration);
        const tests = Array.from(condition.matchAll(/\$\(InuKernelArea([A-Za-z0-9]+)\)'\s*==\s*'true'/g));
        if (tests.length === 0) return true;
        const values = tests.map(match => !!areas[match[1]]);
        return /\s+And\s+/i.test(condition) ? values.every(Boolean) : values.some(Boolean);
    }

    protected sdkProjectNameFromInclude(include: string, containingProjectDirectory?: string): string | undefined {
        const normalised = include.replace(/\\/g, '/');
        for (const sdkPrefix of ['$(InuSdkRoot)/src/', '$(InuOsSdkRoot)/src/']) {
            if (normalised.startsWith(sdkPrefix)) {
                const tail = normalised.slice(sdkPrefix.length);
                const first = tail.split('/')[0];
                return first || undefined;
            }
        }
        if (containingProjectDirectory && !normalised.includes('$(')) {
            const resolved = path.resolve(containingProjectDirectory, normalised);
            const sdkSourceRoot = path.resolve(INU_SDK_ROOT, 'src');
            const relative = path.relative(sdkSourceRoot, resolved).replace(/\\/g, '/');
            if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
                return relative.split('/')[0] || undefined;
            }
        }
        return undefined;
    }

    protected async copySdkSourceWithoutOverwriting(source: string, destination: string): Promise<void> {
        const entries = await fs.readdir(source, { withFileTypes: true });
        await fs.mkdir(destination, { recursive: true });
        for (const entry of entries) {
            if (entry.name === 'bin' || entry.name === 'obj' || entry.name === '.vs') continue;
            const from = path.join(source, entry.name);
            const to = path.join(destination, entry.name);
            if (entry.isDirectory()) {
                await this.copySdkSourceWithoutOverwriting(from, to);
            } else if (entry.isFile()) {
                try {
                    await fs.access(to);
                } catch {
                    await fs.copyFile(from, to);
                }
            }
        }
    }

    protected repairUserlandRuntimeBufferLengths(source: string): string {
        // Repair only the five shipped declarations. Keep unsigned service limits
        // and all other OS-owned source edits unchanged. The casts are idempotent.
        for (const [field, capacity] of [
            ['Input', 'InputCapacity'],
            ['PendingArguments', 'ArgumentCapacity'],
            ['PendingEnvironment', 'EnvironmentCapacity'],
            ['CurrentArguments', 'ArgumentCapacity'],
            ['CurrentEnvironment', 'EnvironmentCapacity']
        ]) {
            const declaration = new RegExp(`(internal\\s+fixed\\s+Byte\\s+${field}\\s*\\[\\s*)${capacity}(\\s*\\])`, 'g');
            source = source.replace(declaration, `$1(Int32)${capacity}$2`);
        }
        return source;
    }

    protected repairPortableExecutableHeaders(source: string): string {
        // Upgrade only the shipped section-only decoder. Preserve author edits elsewhere.
        const replacements: [string, string][] = [
            [
                        "return TryGetPeSection(image,length,segmentIndex,out segment);",
                        "return segmentIndex==0U ? TryGetPeHeaders(image,length,out segment) : TryGetPeSection(image,length,segmentIndex-1U,out segment);"
            ],
            [
                        "sections>MaximumSegments",
                        "sections>=MaximumSegments"
            ],
            [
                        "ProcessExecutableInfo temp=new(ProcessExecutableFormat.PortableExecutable64,entry,imageBase,sections,false);",
                        "if(!TryGetPeHeaders(p,n,out _)) return false;\n        ProcessExecutableInfo temp=new(ProcessExecutableFormat.PortableExecutable64,entry,imageBase,(UInt32)sections+1U,false);"
            ]
];
        const anchor = "    private static Boolean TryGetPeSection(";
        if (source.includes('private static Boolean TryGetPeHeaders(')
            || !source.includes(anchor) || !replacements.every(([old]) => source.includes(old))) return source;
        for (const [old, updated] of replacements) source = source.replace(old, updated);
        return source.replace(anchor, "    private static Boolean TryGetPeHeaders(Byte* p, UInt64 n, out ProcessImageSegment segment)\n    {\n        segment=default; if(p==null || n<64UL) return false;\n        UInt32 pe=Read32(p,0x3CUL); if(!Range(pe,24UL,n)) return false;\n        UInt16 sections=Read16(p,pe+6), optionalSize=Read16(p,pe+20); UInt64 opt=(UInt64)pe+24UL;\n        if(sections==0 || sections>=MaximumSegments || optionalSize<112 || !Range(opt,optionalSize,n)) return false;\n        UInt64 headerBytes=Read32(p,opt+60), imageBytes=Read32(p,opt+56), imageBase=Read64(p,opt+24);\n        UInt64 tableEnd=opt+(UInt64)optionalSize+(UInt64)sections*40UL;\n        if(headerBytes<tableEnd || headerBytes>n || headerBytes>imageBytes ||\n           (imageBase&4095UL)!=0UL || !KernelProtectionMath.IsUserRange(imageBase,headerBytes)) return false;\n        segment=new ProcessImageSegment(imageBase,headerBytes,headerBytes,0UL,ProcessSegmentProtection.Read);\n        return true;\n    }\n\n" + anchor);
    }

    protected repairRing3InteractiveReadiness(source: string): string {
        // Upgrade only the shipped console bridge. Custom input/output handlers
        // keep their policy; unrelated author changes remain intact.
        const replacements: [string, string][] = [
            ["using Inu.Kernel.Console;", "using Inu.Kernel.Console;\nusing Inu.Kernel.Internal.X64;"],
            ["    private static Boolean _initialized;", "    private static Boolean _initialized;\n    private static UInt64 _shellProcessId;\n    private static Boolean _shellOutputWritten,_interactiveReadyPublished;"],
            ["            SetCurrentContext(null,0U,null,0U);", "            SetCurrentContext(null,0U,null,0U);\n            _shellProcessId=shell.Id;_shellOutputWritten=false;"],
            ["    private static Int64 ConsoleInputGet(KernelSystemCallFrame* frame)\n    {\n        if(frame==null)return (Int64)KernelSystemCallError.InvalidArgument;\n        if(_inputRead==_inputWrite)return (Int64)KernelSystemCallError.NotFound;\n        Byte value;fixed(Byte* input=_state.Input)value=input[_inputRead];\n        _inputRead=(_inputRead+1U)%InputCapacity;return value;\n    }\n\n", "    private static Int64 ConsoleInputGet(KernelSystemCallFrame* frame)\n    {\n        if(frame==null)return (Int64)KernelSystemCallError.InvalidArgument;\n        // A live shell has presented output and reached its input service. Empty input\n        // is normal here; acceptance must not wait for the user to press a key.\n        if(!_interactiveReadyPublished&&_shellOutputWritten&&\n           KernelProcesses.TryGetCurrentProcessId(out UInt64 processId)&&processId==_shellProcessId)\n        {\n            if(!KernelConsole.WriteHostControl(\"INTERACTIVE_READY\"))return (Int64)KernelSystemCallError.Fault;\n            _interactiveReadyPublished=true;\n        }\n        // SYSCALL enters with IF clear. Check the queue before STI;HLT, then\n        // mask interrupts again before inspecting it. IRQ handlers queue input;\n        // unrelated interrupts only wake this wait and never complete the read.\n        for(;;)\n        {\n            if(KernelProcesses.IsForegroundCommandCancellationRequested())\n                return KernelProcesses.RequestCurrentProcessExit(KernelProcesses.ForegroundCancellationExitCode,true)?\n                    0L:(Int64)KernelSystemCallError.Fault;\n            if(_inputRead!=_inputWrite)break;\n            Boolean woke=Native.WaitForInterrupt();\n            Boolean masked=Native.DisableInterrupts();\n            if(!woke||!masked)return (Int64)KernelSystemCallError.Fault;\n        }\n        Byte value;fixed(Byte* input=_state.Input)value=input[_inputRead];\n        _inputRead=(_inputRead+1U)%InputCapacity;return value;\n    }\n\n"],
            ["    private static Int64 ConsoleOutputEvent(KernelSystemCallFrame* frame)\n    {\n        if(frame==null||frame->NativeMessage.DataLength>KernelSystemCallMessage.MaximumPayloadBytes)return (Int64)KernelSystemCallError.InvalidArgument;\n        UInt64 remaining=frame->NativeMessage.DataLength,address=frame->NativeMessage.DataAddress;\n        Byte* buffer=stackalloc Byte[(Int32)IoChunkCapacity];\n        while(remaining!=0UL)\n        {\n            UInt32 count=(UInt32)(remaining>IoChunkCapacity?IoChunkCapacity:remaining);\n            if(!KernelSystemCalls.TryCopyFromUser(address,(UInt64)(nuint)buffer,count))return (Int64)KernelSystemCallError.Fault;\n            if(!KernelConsole.WriteAscii(buffer,count))return (Int64)KernelSystemCallError.Fault;\n            address+=count;remaining-=count;\n        }\n        return 0L;\n    }\n\n", "    private static Int64 ConsoleOutputEvent(KernelSystemCallFrame* frame)\n    {\n        if(frame==null||frame->NativeMessage.DataLength>KernelSystemCallMessage.MaximumPayloadBytes)return (Int64)KernelSystemCallError.InvalidArgument;\n        UInt64 remaining=frame->NativeMessage.DataLength,address=frame->NativeMessage.DataAddress;\n        Byte* buffer=stackalloc Byte[(Int32)IoChunkCapacity];\n        while(remaining!=0UL)\n        {\n            UInt32 count=(UInt32)(remaining>IoChunkCapacity?IoChunkCapacity:remaining);\n            if(!KernelSystemCalls.TryCopyFromUser(address,(UInt64)(nuint)buffer,count))return (Int64)KernelSystemCallError.Fault;\n            if(!KernelConsole.WriteAscii(buffer,count))return (Int64)KernelSystemCallError.Fault;\n            address+=count;remaining-=count;\n        }\n        if(frame->NativeMessage.DataLength!=0UL&&\n           KernelProcesses.TryGetCurrentProcessId(out UInt64 processId)&&processId==_shellProcessId)\n            _shellOutputWritten=true;\n        return 0L;\n    }\n\n"]
        ];
        if (source.includes('_interactiveReadyPublished')
            || !replacements.every(([old]) => source.includes(old))) return source;
        for (const [old, updated] of replacements) source = source.replace(old, updated);
        return source;
    }

    protected repairDeviceInventoryBridge(source: string): string {
        if (source.includes('private static Int64 DeviceInspectGet(')) return source;
        const anchor = '    private static Int64 ConsoleInputGet(';
        const ready = '        _initialized=true;return true;';
        if (!source.includes(anchor) || !source.includes(ready) || !source.includes('using Inu.Kernel.Storage;')) return source;
        return source.replace('using Inu.Kernel.Storage;', 'using Inu.Kernel.Storage;\n#if INU_KERNELAREA_DRIVERS\nusing Inu.Kernel.Drivers;\n#endif')
            .replace(ready, "        if(!KernelSystemCalls.RegisterGet(\"system.device.inspect\",&DeviceInspectGet))return false;\n        _initialized=true;return true;")
            .replace(anchor, "    // Get(system.device.inspect), Value0=index, output=8 UInt64 values (64 bytes).\n    // Returns 64, NotFound at the end, or NotImplemented when drivers are unselected.\n    private static Int64 DeviceInspectGet(KernelSystemCallFrame* frame)\n    {\n        if(frame==null||frame->NativeMessage.Value0>0xFFFFFFFFUL||frame->NativeMessage.OutputCapacity<64UL)return (Int64)KernelSystemCallError.InvalidArgument;\n#if INU_KERNELAREA_DRIVERS\n        if(!KernelDrivers.GetCapabilities().Initialized)return (Int64)KernelSystemCallError.NotImplemented;\n        if(!KernelDrivers.TryGetDeviceNodeByIndex((UInt32)frame->NativeMessage.Value0,out KernelDeviceNode node))return (Int64)KernelSystemCallError.NotFound;\n        UInt64* record=stackalloc UInt64[8];\n        record[0]=(UInt64)(Byte)node.Identifier.Bus;record[1]=node.Identifier.VendorId;record[2]=node.Identifier.DeviceId;record[3]=node.Identifier.ClassCode;\n        record[4]=(UInt64)(Byte)node.State;record[5]=node.Driver.Value;record[6]=(UInt64)(UInt32)node.Failure;record[7]=node.Handle.Value;\n        return KernelSystemCalls.TryCopyToUser(frame->NativeMessage.OutputAddress,(UInt64)(nuint)record,64UL)?64L:(Int64)KernelSystemCallError.Fault;\n#else\n        return (Int64)KernelSystemCallError.NotImplemented;\n#endif\n    }\n\n" + anchor);
    }

    protected repairKnownKernelSource(canonical: string, source: string): string {
        if (canonical === 'src/Inu.Kernel.Console/FramebufferConsole.TextEditing.cs') {
            // Match the shipped writer exactly; preserve custom writer implementations.
            const old = "internal Boolean Write(Byte value)\n    {\n        if (value == (Byte)'\\r') return true;\n        if (!HideCaret()) return false;\n        UInt32 linesBefore = _scrollLinesFromBottom == 0U ? 0U : CountVisualLines();\n        if (!_liveView)\n        {\n            AppendHistory(value);\n            if (_scrollLinesFromBottom != 0U)\n            {\n                UInt32 linesAfter = CountVisualLines();\n                if (linesAfter > linesBefore) _scrollLinesFromBottom += linesAfter - linesBefore;\n                return true;\n            }\n        }\n\n        UInt32 previousX = _cursorX;\n        UInt32 previousY = _cursorY;\n        if (!RenderLive(value)) return false;\n\n        // Text is rendered glyph-by-glyph into the active render buffer, but presentation is\n        // deliberately line/region based. Present once when a newline/wrap completes a line;\n        // otherwise keep accumulating the dirty rectangle for the current line.\n        Boolean completedLine = value == (Byte)'\\n' || _cursorY != previousY || _cursorX < previousX;\n        return !completedLine || _batchUpdate || Present();\n    }\n\n";
            const updated = "internal Boolean Write(Byte value)\n    {\n        if (value == (Byte)'\\r') return true;\n        if (value == (Byte)'\\b') return Backspace();\n        if (!HideCaret()) return false;\n        UInt32 linesBefore = _scrollLinesFromBottom == 0U ? 0U : CountVisualLines();\n        if (!_liveView)\n        {\n            AppendHistory(value);\n            if (_scrollLinesFromBottom != 0U)\n            {\n                UInt32 linesAfter = CountVisualLines();\n                if (linesAfter > linesBefore) _scrollLinesFromBottom += linesAfter - linesBefore;\n                return true;\n            }\n        }\n\n        UInt32 previousX = _cursorX;\n        UInt32 previousY = _cursorY;\n        if (!RenderLive(value)) return false;\n\n        // Text is rendered glyph-by-glyph into the active render buffer, but presentation is\n        // deliberately line/region based. Present once when a newline/wrap completes a line;\n        // otherwise keep accumulating the dirty rectangle for the current line.\n        Boolean completedLine = value == (Byte)'\\n' || _cursorY != previousY || _cursorX < previousX;\n        return !completedLine || _batchUpdate || Present();\n    }\n\n";
            return source.includes(old) ? source.replace(old, updated) : source;
        }
        if (canonical === 'src/Inu.Kernel.Processes/ProcessExecutableMath.cs') {
            return this.repairPortableExecutableHeaders(source);
        }
        if (canonical === 'src/Inu.Kernel.Bootstrap/UserlandRuntimeStartup.cs') {
            return this.repairDeviceInventoryBridge(this.repairRing3InteractiveReadiness(this.repairUserlandRuntimeBufferLengths(source)
                .replace(/\bKernelConsole\.Clear\(\)/g, 'KernelConsole.ClearScreen()')));
        }
        if (canonical === 'src/Inu.Kernel.Processes/KernelProcessRecordStore.cs'
            || canonical === 'src/Inu.Kernel.Processes/KernelProcesses.Foreground.cs') {
            if (!/^using\s+Inu\.Kernel\.Internal\.X64\s*;/m.test(source)) {
                source = `using Inu.Kernel.Internal.X64;\n${source}`;
            }
        }
        return source;
    }

    protected async materializeKernelSourcePlan(projectRoot: string, configuration: InuProjectConfiguration): Promise<void> {
        const sourceRoot = path.join(INU_SDK_ROOT, 'src');
        const projects = this.buildProjectGraph(configuration);
        const owners = new Map<string, string>();
        const required = new Set<string>([
            'Inu.Kernel.Entry.X64', 'Inu.Kernel.Console', 'Inu.Kernel.Architecture',
            'Inu.Arch.X64', 'Inu.Kernel.X64.LowLevel', 'Inu.String',
            'Inu.Kernel.SubsystemContracts', 'Inu.Kernel.Power', 'Inu.ApplicationFormat',
            'Inu.Runtime.NativeAot', 'Inu.Runtime.Conformance',
            'Inu.Kernel.Memory', 'Inu.Kernel.VirtualMemory', 'Inu.Kernel.AddressSpace',
            'Inu.Kernel.Heap', 'Inu.Kernel.Platform.X64', 'Inu.Kernel.Acpi',
            'Inu.Kernel.Time', 'Inu.Kernel.Smp', 'Inu.Kernel.Scheduler',
            'Inu.Kernel.Protection', 'Inu.Kernel.Security', 'Inu.Kernel.SystemCalls',
            'Inu.Kernel.Processes', 'Inu.Kernel.InterruptDispatch', 'Inu.Kernel.TimerDispatch',
            'Inu.Kernel.Graphics', 'Inu.Kernel.Drivers', 'Inu.Kernel.Virtio.Gpu',
            // The generic ring-3 console/file bridge and boot telemetry transport are
            // separate from the legacy SDK KMain and its complete OS implementation.
            'Inu.Kernel.Bootstrap', 'Inu.Kernel.Storage'
        ]);
        // The startup source currently uses these kernel mechanisms. Graph placements still
        // determine which device/service providers are started; a compile dependency is not
        // an instruction to start a service or move a graph node to the kernel.
        for (const project of projects) {
            if (project.kind !== 'kernel' && project.kind !== 'kernel-module') continue;
            for (const name of this.managedSdkProjectsForGeneratedProject(project)) {
                required.add(name);
                if (!owners.has(name)) owners.set(name, project.relativePath);
            }
        }
        const kernelAreas = this.sdkKernelAreas(configuration);
        if (kernelAreas.Input) required.add('Inu.Kernel.Ps2');
        if (kernelAreas.USB) {
            required.add('Inu.Usb.Xhci');
            required.add('Inu.Usb.Hub');
            required.add('Inu.Usb.MassStorage');
        }
        const queue = Array.from(required);
        const inventory: Array<{ source: string; destination: string; project: string }> = [];
        const copied = new Set<string>();
        const listSource = async (directory: string): Promise<string[]> => {
            const files: string[] = [];
            for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
                if (['bin', 'obj', '.vs'].includes(entry.name)) continue;
                const candidate = path.join(directory, entry.name);
                if (entry.isDirectory()) files.push(...await listSource(candidate));
                else if (entry.isFile() && entry.name.endsWith('.cs')) files.push(candidate);
            }
            return files.sort();
        };
        for (let index = 0; index < queue.length; index++) {
            const name = queue[index];
            // CoreLib is the one external system module. Only two standalone bridges
            // are needed from Bootstrap; its legacy KMain and full OS stay excluded.
            if (name === 'Inu.Freestanding.CoreLib') continue;
            const directory = path.join(sourceRoot, name);
            const projectFile = path.join(directory, `${name}.csproj`);
            const projectText = await fs.readFile(projectFile, 'utf8');
            if (!/<DisableImplicitFrameworkReferences>\s*true\s*<\/DisableImplicitFrameworkReferences>/.test(projectText)) {
                throw new Error(`Selected kernel dependency ${name} requires the hosted .NET framework and cannot be copied into a freestanding kernel.`);
            }
            for (const match of (name === 'Inu.Kernel.Bootstrap' ? '' : projectText).matchAll(/<ProjectReference\s+Include="([^"]+)"/g)) {
                const dependency = this.sdkProjectNameFromInclude(match[1], directory);
                if (dependency && !required.has(dependency)) { required.add(dependency); queue.push(dependency); }
            }
            const destinationRoot = owners.get(name)
                ? path.join(projectRoot, ...owners.get(name)!.split('/'), name)
                : path.join(projectRoot, 'Kernel', 'Provided', 'Dependencies', name);
            const compileFiles = name === 'Inu.Kernel.Bootstrap'
                ? ['UserlandRuntimeStartup.cs', 'KernelTelemetryTransport.cs'].map(file => path.join(directory, file))
                : /<EnableDefaultCompileItems>\s*false\s*<\/EnableDefaultCompileItems>/.test(projectText)
                    ? [] : await listSource(directory);
            const removed = new Set(Array.from(projectText.matchAll(/<Compile\s+Remove="([^"]+)"/g))
                .map(match => path.resolve(directory, match[1].replace(/\\/g, '/'))));
            for (const match of (name === 'Inu.Kernel.Bootstrap' ? '' : projectText).matchAll(/<Compile\s+Include="([^"]+)"/g)) {
                if (/[*$]/.test(match[1])) throw new Error(`Unsupported source include in ${name}: ${match[1]}`);
                compileFiles.push(path.resolve(directory, match[1].replace(/\\/g, '/')));
            }
            for (const source of compileFiles.filter(file => !removed.has(file))) {
                const canonical = path.relative(INU_SDK_ROOT, source).replace(/\\/g, '/');
                if (copied.has(canonical.toLowerCase())) continue;
                copied.add(canonical.toLowerCase());
                const relativeSource = path.relative(directory, source);
                const destination = path.join(destinationRoot, relativeSource.startsWith('..') ? path.basename(source) : relativeSource);
                await fs.mkdir(path.dirname(destination), { recursive: true });
                try { await fs.access(destination); } catch { await fs.copyFile(source, destination); }
                if (canonical === 'src/Inu.Kernel.Bootstrap/UserlandRuntimeStartup.cs'
                    || canonical === 'src/Inu.Kernel.Console/FramebufferConsole.TextEditing.cs'
                    || canonical === 'src/Inu.Kernel.Processes/ProcessExecutableMath.cs'
                    || canonical === 'src/Inu.Kernel.Processes/KernelProcessRecordStore.cs'
                    || canonical === 'src/Inu.Kernel.Processes/KernelProcesses.Foreground.cs') {
                    const current = await fs.readFile(destination, 'utf8');
                    const repaired = this.repairKnownKernelSource(canonical, current);
                    if (repaired !== current) await fs.writeFile(destination, repaired, 'utf8');
                }
                inventory.push({ source: canonical, destination: path.relative(projectRoot, destination).replace(/\\/g, '/'), project: name });
            }
        }
        const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // The template no longer wildcard-compiles Provided feature trees. Old duplicate
        // files may remain editable on disk, but only this canonical inventory is compiled.
        const targets = ['<Project>', '  <ItemGroup>',
            ...inventory.map(item => `    <Compile Include="$(MSBuildThisFileDirectory)${xml(item.destination)}" />`),
            '  </ItemGroup>', '</Project>', ''].join('\n');
        await fs.writeFile(path.join(projectRoot, 'Inu.KernelSources.targets'), targets, 'utf8');
        await fs.writeFile(path.join(projectRoot, 'Inu.KernelSources.json'), JSON.stringify({
            schemaVersion: 1, files: inventory,
            dependencyProjects: Array.from(required).sort(),
            note: 'Canonical freestanding kernel compilation dependencies. Source is OS-owned; provider activation follows Inu.Configuration.props.'
        }, null, 2) + '\n', 'utf8');
    }

    protected async materializeSelectedManagedSdkSource(projectRoot: string, configuration: InuProjectConfiguration): Promise<void> {
        const sdkSourceRoot = path.join(INU_SDK_ROOT, 'src');
        const localSdkRoot = path.join(projectRoot, 'Kernel', 'Provided', 'SDK');
        const localSourceRoot = path.join(localSdkRoot, 'src');
        await fs.mkdir(localSourceRoot, { recursive: true });

        for (const supportFile of ['Directory.Build.props', 'Directory.Build.targets']) {
            const source = path.join(INU_SDK_ROOT, supportFile);
            const destination = path.join(localSdkRoot, supportFile);
            try { await fs.access(destination); } catch { await fs.copyFile(source, destination); }
        }

        // Only irreducible freestanding/runtime substrate and cross-process dependency projects
        // live under System/SDK/src. Selected OS features themselves are real source in the
        // architecture tree and are never duplicated here.
        const selected = new Set<string>([
            'Inu.Freestanding.CoreLib',
            'Inu.Kernel.Architecture',
            'Inu.Arch.X64',
            'Inu.Kernel.X64.LowLevel',
            'Inu.String',
            'Inu.Kernel.SubsystemContracts',
            'Inu.Kernel.Power',
            'Inu.ApplicationFormat',
            'Inu.Runtime.NativeAot',
            'Inu.Runtime.Conformance',
            // Console rendering is required by the generated x64 UEFI environment. Keep the
            // renderer source visible in the OS under Kernel/Provided/SDK/src.
            'Inu.Kernel.Console',
            'Inu.Kernel.TrueType',
            'Inu.Console.Framebuffer'
        ]);

        await this.materializeKernelSourcePlan(projectRoot, configuration);

        const referencePattern = /<ProjectReference\s+Include="([^"]+)"(?:\s+Condition="([^"]+)")?\s*\/>/g;
        const projects = this.buildProjectGraph(configuration);
        for (const generated of projects) {
            if (generated.kind === 'kernel' || generated.kind === 'kernel-module') continue;
            const implementations = new Set(this.managedSdkProjectsForGeneratedProject(generated));
            for (const implementationProject of implementations) {
                const projectDirectory = path.join(sdkSourceRoot, implementationProject);
                let projectFiles: string[] = [];
                try { projectFiles = (await fs.readdir(projectDirectory)).filter(name => name.endsWith('.csproj')); } catch { continue; }
                for (const projectFile of projectFiles) {
                    const text = await fs.readFile(path.join(projectDirectory, projectFile), 'utf8');
                    for (const match of text.matchAll(referencePattern)) {
                        const dependency = this.sdkProjectNameFromInclude(match[1], projectDirectory);
                        if (dependency && !implementations.has(dependency)) selected.add(dependency);
                    }
                }
            }
        }

        const queue = Array.from(selected);
        for (let index = 0; index < queue.length; index++) {
            const projectName = queue[index];
            const projectDirectory = path.join(sdkSourceRoot, projectName);
            let projectFiles: string[];
            try {
                projectFiles = (await fs.readdir(projectDirectory)).filter(name => name.endsWith('.csproj'));
            } catch {
                throw new Error(`Required Inu substrate source project is missing: ${projectName}`);
            }
            for (const projectFile of projectFiles) {
                const text = await fs.readFile(path.join(projectDirectory, projectFile), 'utf8');
                for (const match of text.matchAll(referencePattern)) {
                    const dependency = this.sdkProjectNameFromInclude(match[1], projectDirectory);
                    if (dependency && !selected.has(dependency)) {
                        selected.add(dependency);
                        queue.push(dependency);
                    }
                }
            }
        }

        for (const projectName of Array.from(selected).sort((a, b) => a.localeCompare(b))) {
            await this.copySdkSourceWithoutOverwriting(
                path.join(sdkSourceRoot, projectName),
                path.join(localSourceRoot, projectName)
            );
        }

        const inventory = [
            '# Inu freestanding/runtime substrate',
            '',
            'Selected OS features are not copied here. Their exact source files live in the OS architecture tree.',
            'This directory contains only compiler/runtime substrate and dependencies needed by separately compiled processes.',
            'Kath copies missing source only; it does not overwrite OS-owned edits.',
            '',
            ...Array.from(selected).sort((a, b) => a.localeCompare(b)).map(name => `- src/${name}`),
            ''
        ].join('\n');
        await fs.writeFile(path.join(localSdkRoot, 'SELECTED-SOURCE.md'), inventory, 'utf8');
    }

    protected sdkToolchainBootstrapLines(): string[] {
        // Generated OS launchers must never install, restore, download, or repair the SDK.
        // Kath's build prepares Inu's pinned toolchain once; Build-Inu.ps1 validates and
        // consumes that existing toolchain (including the sibling Inu toolchain fallback).
        return [
            'set "INU_EMBEDDED_SDK=1"',
            'rem Inu SDK toolchain is prebuilt by the DCLG/Kath build; no runtime installation is permitted.'
        ];
    }

    protected buildBatch(): string {
        return this.sdkBatch('Build-Inu.bat', 'build', '-Configuration Release -NoRun');
    }

    protected runBatch(configuration: InuProjectConfiguration): string {
        const configuredDebugging = configuration.debugging.join(';');
        const debugFeatureFlags = new Map<string, string>([
            ['serial-log', 'INU_DEBUG_SERIAL_LOG'],
            ['kernel-diagnostics', 'INU_DEBUG_KERNEL_DIAGNOSTICS'],
            ['symbols', 'INU_DEBUG_SYMBOLS'],
            ['panic-dump', 'INU_DEBUG_PANIC_DUMP']
        ]);
        const lines = [
            '@echo off',
            `rem [quiet] Inu OS Run launcher generated by Kath ${KATH_VERSION}`,
            'setlocal EnableDelayedExpansion',
            `set "INU_SDK=${INU_SDK_ROOT}"`,
            ...this.sdkToolchainBootstrapLines(),
            'for %%I in ("%~dp0.") do set "INU_PROJECT=%%~fI"',
            'set "INU_MANIFEST=%INU_PROJECT%\\InuProject.json"',
            'set "INU_CONFIGURATION=Release"',
            `set "INU_TARGET_CPUS=${configuration.qemuCpuCount}"`,
            'set "INU_DEBUG_ENABLED=0"',
            `set "INU_DEBUG_CONFIGURED=${configuredDebugging}"`,
            'set "INU_DEBUG_FEATURES="'
        ];

        for (const environmentName of debugFeatureFlags.values()) {
            lines.push(`set "${environmentName}=0"`);
        }

        lines.push(
            'if /I "%~1"=="Debug" (',
            '  set "INU_CONFIGURATION=Debug"'
        );
        if (configuration.debugging.length > 0) {
            lines.push(
                '  set "INU_DEBUG_ENABLED=1"',
                `  set "INU_DEBUG_FEATURES=${configuredDebugging}"`
            );
            for (const feature of configuration.debugging) {
                const environmentName = debugFeatureFlags.get(feature);
                if (environmentName) {
                    lines.push(`  set "${environmentName}=1"`);
                }
            }
        }
        lines.push(
            ')',
            'if /I "%~1"=="Run" set "INU_CONFIGURATION=Release"',
            'rem [quiet] Build configuration: %INU_CONFIGURATION%',
            'if "%INU_DEBUG_ENABLED%"=="1" (',
            '  rem [quiet] Kernel/OS debugging enabled: %INU_DEBUG_FEATURES%',
            ') else (',
            '  if /I "%INU_CONFIGURATION%"=="Debug" (',
            '    rem [quiet] Debug build selected, but no Kernel/OS debugging facilities are enabled in Inu.json.',
            '  ) else (',
            '    rem [quiet] Kernel/OS debugging disabled for Release run.',
            '  )',
            ')',
            'if /I "%INU_CONFIGURATION%"=="Debug" (',
            '  rem [quiet] Debug build completed by the SDK; Kath will attach the debugger transport for the active target.',
            `  call "%INU_SDK%\\Build-Inu.bat" "%INU_MANIFEST%" -Configuration Debug -NoRun`,
            '  exit /b !ERRORLEVEL!',
            ')',
            this.sdkBatch('Build-Inu.bat', 'run', '-Configuration Release -Run').trimEnd(),
            ''
        );
        return lines.join('\r\n');
    }


    protected sdkBatch(entryPoint: string, operation: string, sdkOperation?: string): string {
        return [
            '@echo off',
            `rem [quiet] Inu OS ${operation} launcher generated by Kath ${KATH_VERSION}`,
            'setlocal EnableDelayedExpansion',
            `set "INU_SDK=${INU_SDK_ROOT}"`,
            ...this.sdkToolchainBootstrapLines(),
            'for %%I in ("%~dp0.") do set "INU_PROJECT=%%~fI"',
            `if not exist "%INU_SDK%\\${entryPoint}" (`,
            `  echo [FAIL] Inu SDK ${operation} entry point was not found: %INU_SDK%\\${entryPoint}`,
            '  rem [quiet] The Inu SDK must be present under the sibling Inu\SDK source tree: %INU_SDK%',
            '  exit /b 1',
            ')',
            'if not exist "%INU_PROJECT%\\Inu.json" (',
            '  echo [FAIL] Inu.json was not found in the generated project.',
            '  exit /b 1',
            ')',
            'set "INU_MANIFEST=%INU_PROJECT%\\InuProject.json"',
            'if not exist "%INU_MANIFEST%" (',
            '  echo [FAIL] Inu SDK project manifest was not found: %INU_MANIFEST%',
            '  exit /b 1',
            ')',
            `rem [quiet] Inu SDK: %INU_SDK%`,
            `rem [quiet] Inu project: %INU_PROJECT%`,
            sdkOperation
                ? `call "%INU_SDK%\\${entryPoint}" -Project "%INU_MANIFEST%" ${sdkOperation}`
                : `call "%INU_SDK%\\${entryPoint}" -Project "%INU_MANIFEST%"`,
            'exit /b !ERRORLEVEL!',
            ''
        ].join('\r\n');
    }

    protected publicSdkUsageGuide(configuration: InuProjectConfiguration): string {
        const model = configuration.kernelArchitecture === 'microkernel' ? 'Microkernel' : configuration.kernelArchitecture === 'monolithic' ? 'Monolithic' : configuration.kernelArchitecture === 'custom' ? 'Custom' : 'Hybrid';
        const architectureNote = configuration.kernelArchitecture === 'microkernel'
            ? 'The generated `Kernel\\Kernel.cs` deliberately contains only privileged mechanisms. Drivers, storage, networking, USB, filesystems and GUI responsibilities are represented by service/userland projects rather than being initialized inside the kernel.'
            : configuration.kernelArchitecture === 'monolithic'
                ? 'The generated `Kernel\\Kernel.cs` directly initializes the configured driver, PCI, interrupt-broker, PS/2, VirtIO GPU, storage, NVMe, AHCI, networking, VirtIO, E1000, RTL8168, xHCI, USB hub, HID and mass-storage facilities inside one privileged kernel.'
                : 'The generated `Kernel\\Kernel.cs` keeps the core plus latency-sensitive driver, PCI, interrupt-broker, PS/2 and VirtIO GPU facilities in the kernel while leaving storage, networking and USB as separable higher-level services.';
        return `# Public Inu SDK usage\n\nThis operating system was generated from the **${model}** comprehensive preset in Kath ${KATH_VERSION}.\n\n## Architecture-specific executable example\n\n${architectureNote}\n\nThe three presets intentionally generate different \`Kernel\\Kernel.cs\` files. They do not hide initialization behind the same generic \`BootStartup.Initialize()\` / \`the monolithic HAL initializer\` pair. Instead, the generated kernel source visibly calls the public SDK facilities that belong to that architecture.\n\n## Public core calls demonstrated directly\n\nThe generated kernel source shows real calls such as:\n\n\`\`\`csharp\nInu.Kernel.Console.Console.Run(ConsoleType.Auto, boot); // TBoot : IBootFramebufferContext\nKernelStructuredLogging.Initialize();\nKernelPlatform.InitializeDescriptors();\nKernelPlatform.InitializeInterrupts();\nKernelPlatform.DisableLegacyPic();\nKernelAcpi.Initialize(boot); // TBoot : IAcpiRootPointerContext\nKernelAcpiFadtProvider.Register();\nKernelAcpiFadtServices.Initialize();\nKernelAcpiPowerProvider.Register();\nKernelAcpiPowerServices.Initialize();\nKernelTime.Initialize();\nKernelPhysicalMemory.Initialize(boot, boot); // final-map + page-table-workspace capabilities\nKernelVirtualMemory.Initialize();\nKernelAddressSpace.Initialize();\nKernelEarlyAllocator.Initialize();\nKernelHeap.Initialize();\nKernelGraphics.Initialize();\nKernelSmp.Initialize(boot); // TBoot : IApplicationProcessorTrampolineContext\nKernelScheduler.Initialize();\nInterrupts.Initialize();\nScheduler.Run();\nKernelProtection.Initialize();\nKernelSystemCalls.Initialize();\nKernelProcesses.Initialize();\nInterrupts.Run();\nKernelTimerDispatch.Initialize();\n\`\`\`\n\nHybrid and Monolithic kernels additionally demonstrate the public driver/device APIs assigned to the kernel execution domain. The Monolithic source goes further and directly starts storage, networking and USB families.\n\n## Public capability model\n\nDrivers should consume MMIO, I/O ports, IRQ/MSI/MSI-X, DMA, PCI configuration, physical-memory, timer, networking and filesystem authority through the Inu capability/grant contracts rather than bypassing the broker. The generated driver registration and kernel source are executable examples of the intended public surface.\n\n## Supporting generated files\n\n- **Kernel\\Kernel.cs** — architecture-specific public SDK orchestration.\n- **Boot\\*Startup.cs** — independently selectable boot-stage implementations and diagnostics.\n- **HAL\\*Startup.cs** — independently selectable hardware capability startup components.\n- **Configuration\\GeneratedConfiguration.cs** — exact authoritative feature selections.\n- **Inu.ProjectGraph.json** — generated project/service topology.\n\n## Browse every public contract\n\nOpen **Help -> SDK API** inside Kath for the bundled public API reference.\n`;
    }

    protected projectReadme(configuration: InuProjectConfiguration, projects: GeneratedProject[]): string {
        const projectList = projects.map(project => `- ${project.id} -> ${project.relativePath} (${project.kind})`).join('\n');
        return `# ${configuration.name}\n\nCopyright owner: ${(configuration.author || '').trim() || 'The DCL Group'}\n\nGenerated by Kath ${KATH_VERSION}.\n\nThis project was generated from the authoritative \`Inu.json\` configuration. Only selected subsystems are emitted into the project graph and source tree.\n\n## Core configuration\n\n- Kernel architecture: ${configuration.kernelArchitecture}\n- CPU architecture: ${configuration.targetArchitecture}\n- Boot architecture: ${configuration.bootArchitecture}\n- Memory system: ${configuration.memorySystem}\n- Scheduler: ${configuration.scheduler}\n- Process support: ${configuration.processSupport}\n- Syscall model: ${configuration.syscallModel}\n- SMP: ${configuration.smp}\n- QEMU logical CPUs: ${configuration.qemuCpuCount}\n- OS storage location: ${configuration.location}\n- Interrupt model: ${configuration.interruptModel}\n- Safety profile: ${configuration.safetyProfile}\n\n## Generated projects\n\n${projectList}\n\n## SDK integration\n\nInu.json and Inu.ProjectGraph.json remain the IDE-authoritative configuration and graph. InuProject.json is the generated compatibility manifest passed to the Inu SDK build pipeline. Build.bat and Run.bat pass that manifest file to the source SDK owned by Inu (\`Inu\\SDK\\Build-Inu.bat\`).\n`;
    }

    protected safeSegment(value: string): string {
        return value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/[.-]+/g, '_');
    }

    protected namespace(value: string): string {
        return value.split(/[^A-Za-z0-9]+/).filter(Boolean).map(part => /^[0-9]/.test(part) ? `_${part}` : part).join('.') || 'InuGenerated';
    }
}
