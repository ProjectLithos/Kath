import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import * as net from 'net';
import { createHash } from 'crypto';
import {
    InuBreakpointRequest,
    InuBreakpointResult,
    InuDebugExecutionContext,
    InuDebugFrame,
    InuDebugRegister,
    InuDebugState,
    InuDebugVariable,
    InuDisassemblyInstruction,
    InuTargetProfile,
    InuConfigurationResult,
    InuCrashDumpResult
} from '../common/inu-protocol';
import { INU_SDK_ROOT } from './inu-environment';
import { GdbRspClient, InuExpressionParser } from './inu-debug-support';
import {
    NativeDebugMap,
    NativeGlobalSymbol,
    NativeSourceLine,
    NativeVariableLocation,
    PeImageLayout,
    PeSectionInfo,
    PeUnwindEntry,
    PeUnwindTable,
    ResolvedSourceAddress,
    RunSession,
    SourceBreakpoint,
    StepPlan
} from './inu-debug-types';
import { InuProjectGenerationSupport } from './inu-project-generation';

/**
 * Low-level debugger/runtime transport implementation extracted from the project service.
 * Project discovery, generation, registry and IDE orchestration remain in focused services;
 * this class owns GDB/QEMU/serial transport, symbols, unwind, memory and stepping mechanics.
 */
export abstract class InuRuntimeDebugSupport extends InuProjectGenerationSupport {
    protected abstract getActiveTarget(projectPath: string): Promise<InuTargetProfile | undefined>;
    protected abstract readProjectConfiguration(projectPath: string): Promise<InuConfigurationResult>;
    protected abstract captureCrashDump(sessionId: string, reason?: string): Promise<InuCrashDumpResult>;
    protected abstract ingestTelemetry(session: RunSession, text: string): void;

    protected async loadDebugMapForSession(session: RunSession, debugMapPath: string): Promise<void> {
        const rawDebugMap = JSON.parse(await fs.readFile(debugMapPath, 'utf8')) as { image?: string; map?: string; mapSha256?: string; pdb?: string; anchor?: NativeDebugMap['anchor']; entries?: Array<Record<string, unknown>> };
        const normalizedEntries: NativeSourceLine[] = Array.isArray(rawDebugMap.entries)
            ? rawDebugMap.entries.flatMap(entry => {
                const sourcePath = typeof entry.sourcePath === 'string' ? entry.sourcePath
                    : typeof entry.SourcePath === 'string' ? entry.SourcePath : undefined;
                const lineValue = typeof entry.line === 'number' ? entry.line
                    : typeof entry.Line === 'number' ? entry.Line : undefined;
                const linkedAddress = typeof entry.linkedAddress === 'string' ? entry.linkedAddress
                    : typeof entry.LinkedAddress === 'string' ? entry.LinkedAddress : undefined;
                return sourcePath && sourcePath.trim() && Number.isInteger(lineValue) && (lineValue ?? 0) > 0 && linkedAddress
                    ? [{ sourcePath, line: lineValue!, linkedAddress }]
                    : [];
            })
            : [];
        session.nativeDebugMap = { image: rawDebugMap.image, map: rawDebugMap.map, mapSha256: rawDebugMap.mapSha256, pdb: rawDebugMap.pdb, anchor: rawDebugMap.anchor!, entries: normalizedEntries };
        if (session.nativeDebugMap.anchor?.symbol !== 'InuDebugImageAnchor' || !session.nativeDebugMap.anchor.linkedAddress || !session.nativeDebugMap.anchor.resumeLinkedAddress || session.nativeDebugMap.entries.length === 0) {
            throw new Error('Inu.DebugSymbols.json is incomplete or does not contain the Inu debug rendezvous metadata. Rebuild the SDK/kernel in Debug mode.');
        }
    }

    protected startPhysicalSerialCapture(session: RunSession, target: InuTargetProfile): void {
        const serialPort = target.physical?.serialPort?.trim();
        const baudRate = Math.max(1200, Math.trunc(target.physical?.baudRate ?? 115200));
        if (!serialPort) return;
        if (!/^(?:COM[1-9][0-9]*|\\\\\.\\COM[1-9][0-9]*)$/i.test(serialPort)) {
            session.output += `[WARN] Physical serial port "${serialPort}" is not a supported Windows COM port name. Serial capture was skipped.\r\n`;
            return;
        }
        const script = [
            '$ErrorActionPreference="Stop"',
            '$p=[System.IO.Ports.SerialPort]::new($env:INU_SERIAL_PORT,[int]$env:INU_SERIAL_BAUD,[System.IO.Ports.Parity]::None,8,[System.IO.Ports.StopBits]::One)',
            '$p.ReadTimeout=200',
            '$p.Open()',
            'try { while ($true) { $s=$p.ReadExisting(); if ($s) { [Console]::Out.Write($s); [Console]::Out.Flush() }; Start-Sleep -Milliseconds 25 } } finally { if ($p.IsOpen) { $p.Close() } }'
        ].join('; ');
        const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
            cwd: session.projectRoot,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, INU_SERIAL_PORT: serialPort, INU_SERIAL_BAUD: String(baudRate) }
        });
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', data => {
            const text = String(data);
            this.ingestTelemetry(session, text);
            session.output += text.split(/\r?\n/).filter(Boolean).map(line => `[SERIAL] ${line}\r\n`).join('');
        });
        child.stderr?.once('data', data => { session.output += `[WARN] Physical serial capture ${serialPort}@${baudRate}: ${String(data).trim()}\r\n`; });
        child.on('error', error => { session.output += `[WARN] Could not start physical serial capture: ${error.message}\r\n`; });
        session.physicalSerial = child;
        session.output += `[INFO] Physical serial capture requested on ${serialPort} at ${baudRate} baud.\r\n`;
    }

    protected async launchPhysicalDebugger(session: RunSession, target: InuTargetProfile): Promise<void> {
        if (target.kind !== 'physical' || !target.physical) throw new Error('The selected Inu target does not contain physical debugger settings.');
        const artifactRoot = path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel');
        const imagePath = path.join(artifactRoot, 'MinimalKernel.img');
        const debugMapPath = path.join(artifactRoot, 'Inu.DebugSymbols.json');
        await Promise.all([fs.access(imagePath), fs.access(debugMapPath)]);
        await this.loadDebugMapForSession(session, debugMapPath);
        const debugMap = session.nativeDebugMap;
        if (!debugMap) throw new Error('Inu NativeAOT debug map could not be loaded for the physical debugging session.');

        const host = target.physical.gdbHost.trim();
        const port = target.physical.gdbPort;
        session.output += `\r\n[INFO] Physical debug transport: GDB RSP ${host}:${port}.\r\n`;
        session.output += `[INFO] Boot the freshly-built ${imagePath} on the target machine. A Debug build waits at InuDebugImageAnchor before KMain.\r\n`;
        this.startPhysicalSerialCapture(session, target);

        const gdb = new GdbRspClient(packet => { void this.handleGdbStop(session, packet); });
        await gdb.connect(host, port, 30000);
        session.gdb = gdb;
        session.debug = { active: false, paused: false, sourceSymbols: true, gdbPort: port, message: `Physical debugger attached to ${host}:${port}. Locating Inu rendezvous…` };
        session.output += `[ OK ] Inu physical debugger attached to ${host}:${port}.\r\n`;
        session.output += `[ OK ] Exact source-line map loaded: ${debugMap.entries.length} line mapping(s).\r\n`;

        // A real target may already be stopped by its probe, or the remote stub may report it running.
        // Ctrl-C is standard GDB RSP and gives us a consistent register snapshot.
        session.internalPause = true;
        try { gdb.interrupt(); } catch { }
        await this.waitForPause(session, 5000).catch(() => undefined);

        const runtimeAnchor = await this.readRegister(gdb, 9); // r9 is deliberately loaded with InuDebugImageAnchor by Entry.asm.
        if (runtimeAnchor < 0x10000n) {
            throw new Error(`Physical target did not expose the Inu debug rendezvous in R9 (read 0x${runtimeAnchor.toString(16)}). Boot the freshly-built Debug image and ensure the hardware GDB stub can read x64 registers.`);
        }
        const linkedAnchor = this.parseAddress(debugMap.anchor.linkedAddress);
        session.relocationDelta = runtimeAnchor - linkedAnchor;
        session.output += `[ OK ] Physical rendezvous located: runtime anchor 0x${runtimeAnchor.toString(16)}, linked anchor ${debugMap.anchor.linkedAddress}, delta ${this.formatSignedHex(session.relocationDelta)}.\r\n`;

        session.breakpointResults = [];
        for (const requested of session.requestedBreakpoints) {
            const result = await this.armSourceBreakpoint(session, requested);
            session.breakpointResults.push(result);
            session.output += `[DEBUG] ${result.sourcePath}:${result.line}: ${result.message}\r\n`;
        }
        await this.armExceptionBreakpoints(session);

        const linkedResume = this.parseAddress(debugMap.anchor.resumeLinkedAddress!);
        const runtimeResume = linkedResume + session.relocationDelta;
        await this.writeRip(gdb, runtimeResume);
        session.internalPause = false;

        const unresolved = session.breakpointResults.filter(item => !item.verified);
        if (unresolved.length > 0) {
            session.debug = {
                active: true, paused: true, sourceSymbols: true, gdbPort: port,
                breakpoints: session.breakpointResults.map(item => ({ ...item })),
                message: `${unresolved.length} requested breakpoint(s) could not be verified. Physical kernel held before KMain; fix/remove them, then Continue.`
            };
            session.output += `[WARN] Physical kernel held before KMain because ${unresolved.length} source breakpoint(s) are unresolved.\r\n`;
            return;
        }

        session.debug = {
            active: true, paused: false, sourceSymbols: true, gdbPort: port,
            breakpoints: session.breakpointResults.map(item => ({ ...item })),
            message: `Physical kernel running through ${host}:${port}. Waiting for breakpoint.`
        };
        gdb.run('c');
        session.output += `[ OK ] ${session.breakpointResults.filter(item => item.verified).length}/${session.breakpointResults.length} requested source breakpoint(s) armed before KMain.\r\n`;
        session.output += '[INFO] Physical kernel released. It will stop only at a verified breakpoint, Pause, exception or panic.\r\n';
    }

    protected async copyTextToWindowsClipboard(text: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const clip = spawn('clip.exe', [], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
            let errorText = '';
            clip.stderr?.setEncoding('utf8');
            clip.stderr?.on('data', data => { errorText += data; });
            clip.on('error', reject);
            clip.on('close', code => code === 0 ? resolve() : reject(new Error(errorText.trim() || `clip.exe exited with code ${code ?? -1}.`)));
            clip.stdin?.end(text, 'utf8');
        });
    }

    protected async sha256File(filePath: string): Promise<string> {
        const hash = createHash('sha256');
        hash.update(await fs.readFile(filePath));
        return hash.digest('hex');
    }

    protected async launchDebugQemu(session: RunSession): Promise<void> {
        const projectManifestPath = path.join(session.projectRoot, 'InuProject.json');
        const projectManifest = JSON.parse(await fs.readFile(projectManifestPath, 'utf8')) as { Name?: string; OutputDirectory?: string };
        const projectName = projectManifest.Name?.trim();
        const configuredOutput = projectManifest.OutputDirectory?.trim();
        if (!projectName || !configuredOutput) throw new Error('InuProject.json does not identify the Debug image output directory.');
        const artifactRoot = path.isAbsolute(configuredOutput) ? path.normalize(configuredOutput) : path.resolve(session.projectRoot, configuredOutput);
        const imagePath = path.join(artifactRoot, `${projectName}.img`);
        const kernelPath = path.join(artifactRoot, `${projectName}.bin`);
        const debugMapPath = path.join(artifactRoot, 'Inu.DebugSymbols.json');
        const imageManifestPath = path.join(artifactRoot, 'Inu.Image.json');
        const qemuPath = 'C:\\Program Files\\qemu\\qemu-system-x86_64.exe';
        const ovmfCode = 'C:\\Program Files\\qemu\\share\\edk2-x86_64-code.fd';
        const ovmfVars = 'C:\\Program Files\\qemu\\share\\edk2-i386-vars.fd';
        await Promise.all([fs.access(imagePath), fs.access(kernelPath), fs.access(debugMapPath), fs.access(imageManifestPath), fs.access(qemuPath), fs.access(ovmfCode), fs.access(ovmfVars)]);

        const [rawDebugMap, rawImageManifest] = await Promise.all([
            fs.readFile(debugMapPath, 'utf8').then(text => JSON.parse(text) as { schemaVersion?: number; image?: string; kernelSha256?: string; map?: string; mapSha256?: string }),
            fs.readFile(imageManifestPath, 'utf8').then(text => JSON.parse(text) as { configuration?: string; nativeDebugSymbols?: boolean; imagePath?: string; imageSha256?: string; kernelSha256?: string })
        ]);
        if (rawImageManifest.configuration !== 'Debug' || rawImageManifest.nativeDebugSymbols !== true)
            throw new Error('Kath refused to start the debugger because the selected FAT32 image is not attested as a Debug image.');
        if (!rawImageManifest.imagePath || path.normalize(rawImageManifest.imagePath).toLowerCase() !== path.normalize(imagePath).toLowerCase())
            throw new Error('Debug image manifest points at a different FAT32 image than the selected OS.');
        if (!rawDebugMap.image || path.normalize(rawDebugMap.image).toLowerCase() !== path.normalize(kernelPath).toLowerCase())
            throw new Error('Debug symbol map points at a different native kernel than the selected OS.');
        const expectedMapPath = path.join(artifactRoot, `${projectName}.map`);
        if ((rawDebugMap.schemaVersion ?? 0) < 2 || !rawDebugMap.map || !rawDebugMap.mapSha256)
            throw new Error('Debug symbol manifest does not attest the exact linker map. Rebuild this OS in Debug with Inu 0.0.196 or later.');
        if (path.normalize(rawDebugMap.map).toLowerCase() !== path.normalize(expectedMapPath).toLowerCase())
            throw new Error('Debug symbol manifest points at a different linker map than the selected OS.');
        await fs.access(expectedMapPath);
        const [actualImageSha256, actualKernelSha256, actualMapSha256] = await Promise.all([
            this.sha256File(imagePath), this.sha256File(kernelPath), this.sha256File(expectedMapPath)
        ]);
        if (!rawImageManifest.imageSha256 || rawImageManifest.imageSha256.toLowerCase() !== actualImageSha256)
            throw new Error('Debug FAT32 image hash no longer matches Inu.Image.json. Rebuild Debug before launching QEMU.');
        if (!rawImageManifest.kernelSha256 || rawImageManifest.kernelSha256.toLowerCase() !== actualKernelSha256 || !rawDebugMap.kernelSha256 || rawDebugMap.kernelSha256.toLowerCase() !== actualKernelSha256)
            throw new Error('Debug kernel/image/symbol-map attestation failed. Kath will not boot a stale Release kernel under a Debug symbol map.');
        if (rawDebugMap.mapSha256.toLowerCase() !== actualMapSha256)
            throw new Error('Debug linker-map hash no longer matches Inu.DebugSymbols.json. Kath will not arm breakpoints from a stale map.');
        session.output += `[ OK ] Debug artifact attestation: image, native kernel and exact linker map hashes match the selected OS build.\r\n`;

        await this.loadDebugMapForSession(session, debugMapPath);
        const debugMap = session.nativeDebugMap;
        if (!debugMap) throw new Error('Inu NativeAOT debug map could not be loaded for the QEMU debugging session.');

        const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
        const runDirectory = path.join(artifactRoot, 'Runs', `debug-${stamp}`);
        await fs.mkdir(runDirectory, { recursive: true });
        const varsCopy = path.join(runDirectory, 'OVMF_VARS.fd');
        const serialLog = path.join(runDirectory, 'serial.log');
        session.serialLogPath = serialLog;
        session.serialLogOffset = 0;
        session.serialDisplayPending = '';
        const debugConLog = path.join(runDirectory, 'debugcon.bin');
        await fs.copyFile(ovmfVars, varsCopy);
        const gdbPort = await this.findFreePort(1234, 1299);
        const qmpPort = await this.findFreePort(1300, 1399);
        const activeTarget = await this.getActiveTarget(session.projectRoot);
        const qemu = activeTarget?.kind === 'qemu' ? activeTarget.qemu : undefined;
        const configured = await this.readProjectConfiguration(session.projectRoot);
        const qemuCpus = configured.configuration?.qemuCpuCount ?? qemu?.cpuCount ?? 1;
        const memoryMiB = Math.max(64, qemu?.memoryMiB ?? 512);
        const machine = qemu?.machine || 'q35';
        const accelerator = qemu?.accelerator ?? 'auto';
        const display = qemu?.display || 'sdl';
        const autoAccelerator = process.platform === 'win32' ? 'whpx:tcg' : process.platform === 'linux' ? 'kvm:tcg' : process.platform === 'darwin' ? 'hvf:tcg' : 'tcg';
        const acceleratorArgs = accelerator === 'auto'
            ? (autoAccelerator === 'tcg' ? ['-machine', machine, '-accel', 'tcg,thread=multi'] : ['-machine', `${machine},accel=${autoAccelerator}`])
            : ['-machine', machine, '-accel', accelerator === 'tcg' ? 'tcg,thread=multi' : accelerator];
        const cpuArgs = accelerator === 'tcg' ? ['-cpu', 'max'] : [];
        const args = [
            ...acceleratorArgs, ...cpuArgs, '-smp', String(qemuCpus), '-m', `${memoryMiB}M`,
            '-display', display,
            '-drive', `if=pflash,format=raw,unit=0,readonly=on,file=${ovmfCode}`,
            '-drive', `if=pflash,format=raw,unit=1,file=${varsCopy}`,
            '-drive', `if=none,format=raw,file=${imagePath},id=boot`,
            '-device', 'virtio-blk-pci,disable-legacy=on,drive=boot,bootindex=0', '-device', 'virtio-vga',
            '-boot', 'order=c,menu=off,strict=on', '-serial', `file:${serialLog}`,
            '-debugcon', `file:${debugConLog}`, '-global', 'isa-debugcon.iobase=0xe9',
            '-monitor', 'none', '-no-reboot', '-no-shutdown',
            '-qmp', `tcp:127.0.0.1:${qmpPort},server=on,wait=off`,
            '-gdb', `tcp:127.0.0.1:${gdbPort}`
        ];
        session.output += `\r\n[INFO] Debug launch: QEMU GDB endpoint 127.0.0.1:${gdbPort}; lifecycle QMP endpoint 127.0.0.1:${qmpPort}.\r\n`;
        session.output += '[INFO] QEMU graphics: virtio-vga (primary VirtIO-GPU 2D frontend; no VirGL/OpenGL guest acceleration).\r\n';
        session.output += '[INFO] QEMU boots immediately to the internal Inu debug rendezvous; the rendezvous itself parks the native kernel entry before KMain.\r\n';
        session.output += '[INFO] The IDE attaches to the live GDB endpoint while the rendezvous provides the deterministic pre-KMain hold.\r\n';
        session.output += '[INFO] The rendezvous publishes the relocated native-kernel address through QEMU debugcon; it is never shown as a user breakpoint.\r\n';
        session.qemu = spawn(qemuPath, args, { cwd: session.projectRoot, detached: false, windowsHide: false, stdio: 'ignore' });
        session.qemu.on('error', error => {
            session.error = error.message;
            session.output += `\r\n[FAIL] QEMU debugger launch failed: ${error.message}\r\n`;
            session.complete = true;
            session.exitCode = 1;
        });
        session.qemu.on('close', (code, signal) => {
            if (session.complete) { return; }
            void this.finalizeDebugQemuExit(session, code, signal);
        });
        await this.connectQmpLifecycleMonitor(session, qmpPort, 5000);
        if (session.complete) { return; }

        // QEMU's system gdbstub stops the VM when a debugger client CONNECTS, even when
        // QEMU itself was launched without -S.  Therefore the transport must remain fully
        // disconnected while OVMF boots.  The guest-owned kernel rendezvous publishes NODBG64!
        // first and parks in HLT; only then may the IDE attach the GDB client.
        session.debug = { active: false, paused: false, sourceSymbols: true, gdbPort, message: 'Firmware booting to the Inu debug rendezvous…' };
        session.output += '[INFO] GDB transport intentionally remains disconnected until the kernel rendezvous is published.\r\n';
        session.output += `[ OK ] Exact source-line map loaded: ${debugMap.entries.length} line mapping(s).\r\n`;
        const runtimeAnchor = await this.waitForDebugRendezvous(session, debugConLog, 30000);
        session.output += `[ OK ] Inu debug rendezvous reached at runtime address 0x${runtimeAnchor.toString(16)}.\r\n`;

        const gdb = new GdbRspClient(packet => { void this.handleGdbStop(session, packet); });
        session.internalPause = true;
        session.debug = { active: false, paused: false, sourceSymbols: true, gdbPort, message: 'Rendezvous reached. Attaching debugger…' };
        await gdb.connect('127.0.0.1', gdbPort, 15000);
        session.gdb = gdb;
        session.output += `[ OK ] Inu debugger attached to QEMU on port ${gdbPort} after kernel rendezvous publication.\r\n`;
        // QEMU system emulation stops the VM when the gdbstub connection opens, but modern
        // QEMU intentionally does not emit an unsolicited stop packet. RSP is client-driven:
        // ask '?' for the current stop reason. GdbRspClient must treat the resulting T/S packet
        // as both the synchronous command reply and a stop event. Ctrl-C remains a fallback for
        // a stub that reports no stopped state after the rendezvous-owned attach.
        let attachStopReply: string | undefined;
        try { attachStopReply = await gdb.command('?'); } catch { attachStopReply = undefined; }
        if (!session.debug?.paused) {
            gdb.interrupt();
            await this.waitForPause(session, 3000);
        }
        if (attachStopReply && !/^[TS]/.test(attachStopReply)) {
            session.output += `[WARN] QEMU returned unexpected initial GDB stop reply: ${attachStopReply}.\r\n`;
        }

        const linkedAnchor = this.parseAddress(debugMap.anchor.linkedAddress);
        session.relocationDelta = runtimeAnchor - linkedAnchor;
        session.output += `[ OK ] kernel runtime relocation resolved: linked anchor ${debugMap.anchor.linkedAddress}, runtime anchor 0x${runtimeAnchor.toString(16)}, delta ${this.formatSignedHex(session.relocationDelta)}.\r\n`;

        session.breakpointResults = [];
        for (const requested of session.requestedBreakpoints) {
            const result = await this.armSourceBreakpoint(session, requested);
            session.breakpointResults.push(result);
            session.output += `[DEBUG] ${result.sourcePath}:${result.line}: ${result.message}\r\n`;
        }
        await this.armExceptionBreakpoints(session);

        const linkedResume = this.parseAddress(debugMap.anchor.resumeLinkedAddress!);
        const runtimeResume = linkedResume + session.relocationDelta;
        await this.writeRip(gdb, runtimeResume);
        session.internalPause = false;

        const unresolved = session.breakpointResults.filter(item => !item.verified);
        if (unresolved.length > 0) {
            session.debug = {
                active: true, paused: true, sourceSymbols: true, gdbPort,
                breakpoints: session.breakpointResults.map(item => ({ ...item })),
                message: `${unresolved.length} requested breakpoint(s) could not be verified. Kernel held before KMain; fix/remove them, then Continue.`
            };
            session.output += `[WARN] ${session.breakpointResults.filter(item => item.verified).length}/${session.breakpointResults.length} requested source breakpoint(s) armed before KMain.\r\n`;
            session.output += `[WARN] Kernel is held before KMain because ${unresolved.length} requested breakpoint(s) are unresolved. Remove or move the unverified breakpoint(s), then press Continue.\r\n`;
            return;
        }

        session.debug = {
            active: true, paused: false, sourceSymbols: true, gdbPort,
            breakpoints: session.breakpointResults.map(item => ({ ...item })),
            message: 'Kernel running. Waiting for breakpoint.'
        };
        gdb.run('c');
        session.output += `[ OK ] ${session.breakpointResults.filter(item => item.verified).length}/${session.breakpointResults.length} requested source breakpoint(s) armed before KMain.\r\n`;
        session.output += '[INFO] Kernel released. It will stop only at a verified breakpoint, Pause, exception or panic.\r\n';
        const checkpoints = [
            ['NORESUME', 'debug resume'],
            ['NORTINIT', 'native runtime initialization'],
            ['NOMANAGE', 'managed kernel entry']
        ];
        for (const [tag, stage] of checkpoints) {
            if (await this.waitForDebugCheckpoint(debugConLog, tag, 3000)) {
                session.output += `[ OK ] Early boot checkpoint reached: ${stage}.\r\n`;
            } else {
                session.output += `[WARN] Early boot checkpoint not reached within 3 seconds: ${stage}. The guest is stopped or hung before this stage.\r\n`;
                break;
            }
        }
    }

    protected recordQmpLifecycleEvent(session: RunSession, message: Record<string, unknown>): void {
        const event = typeof message.event === 'string' ? message.event : undefined;
        if (!event) return;
        if (!['SHUTDOWN', 'RESET', 'GUEST_PANICKED', 'WATCHDOG'].includes(event)) return;
        const data = message.data && typeof message.data === 'object' ? message.data as Record<string, unknown> : {};
        const reason = typeof data.reason === 'string' ? data.reason : undefined;
        const guest = typeof data.guest === 'boolean' ? data.guest : undefined;
        let detail: string | undefined;
        try { detail = JSON.stringify(data); } catch { detail = undefined; }
        session.qmpTerminationEvent = { event, reason, guest, detail };
    }

    protected async connectQmpLifecycleMonitor(session: RunSession, port: number, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        let lastError = 'QMP endpoint did not accept a connection.';
        while (!session.complete && Date.now() < deadline) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const socket = net.createConnection({ host: '127.0.0.1', port });
                    let buffer = '';
                    let capabilitiesSent = false;
                    let ready = false;
                    const timer = setTimeout(() => {
                        if (!ready) {
                            socket.destroy();
                            reject(new Error('QMP capability negotiation timed out.'));
                        }
                    }, 1200);
                    const fail = (error: Error) => {
                        if (!ready) {
                            clearTimeout(timer);
                            socket.destroy();
                            reject(error);
                        } else {
                            session.output += `[WARN] QEMU QMP lifecycle monitor error: ${error.message}\r\n`;
                        }
                    };
                    socket.setEncoding('utf8');
                    socket.on('data', chunk => {
                        buffer += String(chunk);
                        for (;;) {
                            const newline = buffer.indexOf('\n');
                            if (newline < 0) break;
                            const line = buffer.slice(0, newline).trim();
                            buffer = buffer.slice(newline + 1);
                            if (!line) continue;
                            let message: Record<string, unknown>;
                            try { message = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
                            this.recordQmpLifecycleEvent(session, message);
                            if (message.QMP && !capabilitiesSent) {
                                capabilitiesSent = true;
                                socket.write('{"execute":"qmp_capabilities"}\r\n');
                                continue;
                            }
                            if (capabilitiesSent && Object.prototype.hasOwnProperty.call(message, 'return') && !ready) {
                                ready = true;
                                clearTimeout(timer);
                                session.qmpSocket = socket;
                                resolve();
                            }
                        }
                    });
                    socket.once('error', error => fail(error));
                    socket.once('close', () => {
                        if (session.qmpSocket === socket) session.qmpSocket = undefined;
                        if (!ready) fail(new Error('QMP socket closed before capabilities were enabled.'));
                    });
                });
                session.output += `[ OK ] QEMU QMP lifecycle monitor attached on 127.0.0.1:${port}; shutdown/reset causes will be classified explicitly.\r\n`;
                return;
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                await new Promise(resolve => setTimeout(resolve, 80));
            }
        }
        if (!session.complete) {
            session.output += `[WARN] QEMU QMP lifecycle monitor was unavailable: ${lastError} Termination will be reported from the process exit code only.\r\n`;
        }
    }

    protected async finalizeDebugQemuExit(session: RunSession, code: number | null, signal: NodeJS.Signals | null = null): Promise<void> {
        session.gdb?.close();
        session.qmpSocket?.destroy();
        session.qmpSocket = undefined;
        const unsignedCode = code === null ? 0 : (code >>> 0);
        const hexCode = `0x${unsignedCode.toString(16).toUpperCase().padStart(8, '0')}`;
        const lifecycle = session.qmpTerminationEvent;
        const lifecycleReason = lifecycle?.reason ? ` reason=${lifecycle.reason}` : '';
        const lifecycleGuest = lifecycle?.guest === undefined ? '' : ` guest=${lifecycle.guest ? 'yes' : 'no'}`;
        if (session.serialLogPath) {
            session.output += `\r\n[INFO] Kernel serial output is kept out of the IDE Output tab. Serial log: ${session.serialLogPath}\r\n`;
        }
        if (session.stoppedByUser) {
            session.output += `[ OK ] QEMU debug process terminated by Stop Run${code === null ? (signal ? ` (${signal})` : '') : ` (exit code ${code})`}.\r\n`;
            session.debug = { ...(session.debug ?? { sourceSymbols: false }), active: false, paused: false, sourceSymbols: session.debug?.sourceSymbols ?? false, message: 'Run cancelled by the user.' };
            session.exitCode = 0;
            session.complete = true;
            return;
        }

        const stoppedDiagnostic = session.debug?.paused &&
            (session.debug.exceptionVector !== undefined || !!session.debug.exceptionName);
        if (stoppedDiagnostic) {
            const reason = session.debug?.exceptionName ?? 'diagnostic stop';
            session.output += `[WARN] QEMU debug process ended while the kernel was paused at ${reason}; exit=${code === null ? 'none' : code}${signal ? ` signal=${signal}` : ''}${lifecycle ? ` QMP=${lifecycle.event}${lifecycleReason}${lifecycleGuest}` : ''}.\r\n`;
            session.debug = {
                ...(session.debug ?? { sourceSymbols: false }), active: false, paused: false,
                sourceSymbols: session.debug?.sourceSymbols ?? false,
                message: `QEMU ended while paused at ${reason}.`
            };
            session.exitCode = 0;
            session.complete = true;
            return;
        }

        if (lifecycle?.event === 'GUEST_PANICKED' || lifecycle?.reason === 'guest-panic') {
            session.error = `QEMU reported a guest panic before exit${lifecycleReason}.`;
            session.output += `[FAIL] ${session.error}\r\n`;
            session.debug = { ...(session.debug ?? { sourceSymbols: false }), active: false, paused: false, sourceSymbols: session.debug?.sourceSymbols ?? false, message: session.error };
            session.exitCode = 1;
            session.complete = true;
            return;
        }
        if (lifecycle?.event === 'RESET' && (lifecycle.reason === 'guest-reset' || lifecycle.guest === true)) {
            session.error = `The guest reset while Debug was running${lifecycleReason}. With -no-reboot active, QEMU then exited; this is a guest/runtime reset, not Stop Run.`;
            session.output += `[FAIL] ${session.error}\r\n`;
            session.debug = { ...(session.debug ?? { sourceSymbols: false }), active: false, paused: false, sourceSymbols: session.debug?.sourceSymbols ?? false, message: session.error };
            session.exitCode = 1;
            session.complete = true;
            return;
        }

        if (lifecycle?.event === 'SHUTDOWN' || lifecycle?.event === 'RESET') {
            const actor = lifecycle.guest === true ? 'guest' : lifecycle.guest === false ? 'host' : 'QEMU';
            session.output += `[INFO] QEMU lifecycle: ${lifecycle.event}${lifecycleReason}${lifecycleGuest}; process exit=${code === null ? 'none' : code}${signal ? ` signal=${signal}` : ''}.\r\n`;
            const hostClose = lifecycle.reason === 'host-ui' || lifecycle.reason === 'host-signal' || lifecycle.reason === 'host-qmp-quit';
            const message = hostClose
                ? `QEMU was closed from the host (${lifecycle.reason}).`
                : `${actor} caused QEMU ${lifecycle.event.toLowerCase()}${lifecycle.reason ? ` (${lifecycle.reason})` : ''}.`;
            session.output += `[ OK ] ${message}\r\n`;
            session.debug = { ...(session.debug ?? { sourceSymbols: false }), active: false, paused: false, sourceSymbols: session.debug?.sourceSymbols ?? false, message };
            session.exitCode = 0;
            session.complete = true;
            return;
        }

        if (code === 0) {
            const message = 'QEMU process exited with code 0, but QMP published no shutdown/reset cause. Kath will no longer label this ambiguous exit as a normal guest shutdown.';
            session.output += `[INFO] ${message}\r\n`;
            session.debug = { ...(session.debug ?? { sourceSymbols: false }), active: false, paused: false, sourceSymbols: session.debug?.sourceSymbols ?? false, message };
            session.exitCode = 0;
        } else if (code === null) {
            const message = signal
                ? `QEMU process ended by signal ${signal}; QMP published no shutdown/reset cause.`
                : 'QEMU process ended without an exit code or QMP shutdown/reset cause.';
            session.output += `[WARN] ${message}\r\n`;
            session.debug = { ...(session.debug ?? { sourceSymbols: false }), active: false, paused: false, sourceSymbols: session.debug?.sourceSymbols ?? false, message };
            session.exitCode = 0;
        } else if (unsignedCode >= 0x80000000) {
            const explanation = unsignedCode === 0xCFFFFFFF
                ? 'Windows terminated QEMU after its window became unresponsive or was force-closed.'
                : 'QEMU terminated with a Windows abnormal-process status.';
            session.error = `QEMU terminated abnormally with Windows status ${hexCode}. ${explanation}`;
            session.output += `\r\n[FAIL] ${session.error}\r\n`;
            session.debug = { ...(session.debug ?? { sourceSymbols: false }), active: false, paused: false, sourceSymbols: session.debug?.sourceSymbols ?? false, message: session.error };
            session.exitCode = 1;
        } else {
            session.error = `QEMU debug process exited with code ${code}${signal ? ` (${signal})` : ''}; QMP published no shutdown/reset cause.`;
            session.output += `\r\n[FAIL] ${session.error}\r\n`;
            session.debug = { ...(session.debug ?? { sourceSymbols: false }), active: false, paused: false, sourceSymbols: session.debug?.sourceSymbols ?? false, message: session.error };
            session.exitCode = code;
        }
        session.complete = true;
    }

    protected async armSourceBreakpoint(session: RunSession, request: InuBreakpointRequest): Promise<InuBreakpointResult> {
        const sourcePath = request.sourcePath;
        const line = request.line;
        const condition = request.condition?.trim() || undefined;
        const hitCondition = request.hitCondition?.trim() || undefined;
        if (!session.gdb || session.relocationDelta === undefined || !session.nativeDebugMap) {
            return { success: false, verified: false, sourcePath, line, condition, hitCondition, hitCount: 0, message: 'The native source map or EFI relocation is not ready.' };
        }
        if (hitCondition && !this.isValidHitCondition(hitCondition)) {
            return { success: false, verified: false, sourcePath, line, condition, hitCondition, hitCount: 0, message: `Invalid hit-count expression "${hitCondition}". Use N, =N, >=N, >N, <=N, <N, or %N.` };
        }
        const resolved = this.resolveLinkedSourceAddress(session.nativeDebugMap, sourcePath, line);
        if (resolved === undefined) {
            return { success: false, verified: false, sourcePath, line, condition, hitCondition, hitCount: 0, message: 'No executable NativeAOT sequence point exists on this C# line or a nearby executable line in the same source file.' };
        }
        const runtimeAddress = resolved.linkedAddress + session.relocationDelta;
        const address = runtimeAddress.toString(16);
        const reply = await session.gdb.command(`Z0,${address},1`);
        const breakpoint: SourceBreakpoint = { sourcePath: path.resolve(sourcePath), line, resolvedLine: resolved.resolvedLine, address, condition, hitCondition, hitCount: 0 };
        if (reply === 'OK') {
            session.breakpoints.set(`${path.resolve(sourcePath).toLowerCase()}:${line}`, breakpoint);
        }
        const binding = resolved.exactLine
            ? `line ${line}`
            : `requested line ${line} -> executable line ${resolved.resolvedLine}`;
        return {
            success: reply === 'OK',
            verified: reply === 'OK',
            sourcePath,
            line,
            resolvedLine: resolved.resolvedLine,
            address,
            condition,
            hitCondition,
            hitCount: 0,
            message: reply === 'OK'
                ? `Breakpoint verified (${binding}) at runtime address 0x${address}.`
                : `QEMU rejected the source breakpoint (${binding}): ${reply}`
        };
    }

    protected async armExceptionBreakpoints(session: RunSession): Promise<void> {
        if (!session.gdb || session.relocationDelta === undefined) { return; }
        const mapPath = session.nativeDebugMap?.map;
        if (!mapPath) {
            session.output += '[WARN] Exception/panic breakpoints could not be armed because the selected Debug symbol manifest does not identify its exact linker map.\r\n';
            return;
        }
        try {
            const mapText = await fs.readFile(mapPath, 'utf8');
            session.exceptionBreakpointAddresses.clear();
            session.panicDebuggerBreakAddress = undefined;
            session.interruptStackSwitchAddress = undefined;
            const stackSwitchLinked = this.findLinkedSymbolAddress(mapText, 'InuX64InterruptStackSwitch');
            if (stackSwitchLinked !== undefined) {
                session.interruptStackSwitchAddress = stackSwitchLinked + session.relocationDelta;
            }
            const panicDebugLinked = this.findLinkedSymbolAddress(mapText, 'InuX64PanicDebuggerBreak');
            if (panicDebugLinked !== undefined) {
                session.panicDebuggerBreakAddress = panicDebugLinked + session.relocationDelta;
            }
            if (session.exceptionBreakpoints.vectors.length > 0) {
                const armed: number[] = [];
                const unavailable: number[] = [];
                let directLabels = 0;
                let decodedStubs = 0;
                for (const vector of session.exceptionBreakpoints.vectors) {
                    const resolved = await this.resolveNormalizedExceptionBreakpoint(session, mapText, vector);
                    if (!resolved) {
                        unavailable.push(vector);
                        continue;
                    }
                    if (resolved.kind === 'debug-frame') directLabels++;
                    else decodedStubs++;
                    const runtime = resolved.linkedAddress + session.relocationDelta;
                    const reply = await session.gdb.command(`Z0,${runtime.toString(16)},1`);
                    if (reply === 'OK') {
                        session.exceptionBreakpointAddresses.set(runtime, vector);
                        armed.push(vector);
                    } else {
                        session.output += `[WARN] QEMU rejected CPU exception vector ${vector} breakpoint: ${reply}.\r\n`;
                    }
                }
                if (armed.length > 0) {
                    const resolution = decodedStubs > 0
                        ? ` (${directLabels} map-frame label(s), ${decodedStubs} decoded vector stub(s))`
                        : '';
                    session.output += `[ OK ] CPU exception breakpoints armed on normalized vector frames: ${armed.join(', ')}${resolution}. Hardware IRQs remain uninterrupted.\r\n`;
                }
                if (unavailable.length > 0) {
                    session.output += `[WARN] Normalized CPU exception breakpoint location(s) could not be resolved for vector(s): ${unavailable.join(', ')}.\r\n`;
                }
            }
            if (session.exceptionBreakpoints.breakOnPanic) {
                const linked = this.findLinkedSymbolAddress(mapText, 'InuX64StopProcessor');
                if (linked !== undefined) {
                    const runtime = linked + session.relocationDelta;
                    const reply = await session.gdb.command(`Z0,${runtime.toString(16)},1`);
                    if (reply === 'OK') {
                        session.panicBreakpointAddress = runtime;
                        session.output += '[ OK ] Fatal/panic stop breakpoint armed.\r\n';
                    } else {
                        session.output += `[WARN] QEMU rejected the fatal/panic stop breakpoint: ${reply}.\r\n`;
                    }
                } else {
                    session.output += `[WARN] Fatal/panic stop symbol was not found in ${path.basename(mapPath)}.\r\n`;
                }
            }
        } catch (error) {
            session.output += `[WARN] Exception/panic breakpoints could not be armed: ${error instanceof Error ? error.message : String(error)}.\r\n`;
        }
    }

    /** Resolve the post-normalisation point even when LLD omits local DebugFrame labels from its map. */
    protected async resolveNormalizedExceptionBreakpoint(
        session: RunSession,
        mapText: string,
        vector: number
    ): Promise<{ linkedAddress: bigint; kind: 'debug-frame' | 'decoded-stub' } | undefined> {
        const direct = this.findLinkedSymbolAddress(mapText, `InuX64InterruptDebugFrame${vector}`);
        if (direct !== undefined) return { linkedAddress: direct, kind: 'debug-frame' };
        if (!session.gdb || session.relocationDelta === undefined) return undefined;

        // Global vector-stub symbols are retained by LLD more consistently than the
        // per-stub post-push labels. Decode only far enough to find the unconditional
        // branch to InuX64InterruptCommon. A software breakpoint on that JMP executes
        // after the stub has pushed [vector,error], so RSP has the normalized frame.
        const stub = this.findLinkedSymbolAddress(mapText, `InuX64InterruptStub${vector}`);
        if (stub === undefined) return undefined;
        const runtimeStub = stub + session.relocationDelta;
        const bytes = await this.readMemory(session.gdb, runtimeStub, 24);
        for (let i = 0; i < bytes.length; i++) {
            const opcode = bytes[i];
            if (opcode === 0xE9 && i + 4 < bytes.length) {
                return { linkedAddress: stub + BigInt(i), kind: 'decoded-stub' };
            }
            if (opcode === 0xEB && i + 1 < bytes.length) {
                return { linkedAddress: stub + BigInt(i), kind: 'decoded-stub' };
            }
        }
        return undefined;
    }

    protected findLinkedSymbolAddress(mapText: string, symbol: string): bigint | undefined {
        for (const line of mapText.split(/\r?\n/)) {
            if (!line.trim().split(/\s+/).includes(symbol)) { continue; }
            const values = Array.from(line.matchAll(/(?:0x)?([0-9a-fA-F]{8,16})/g))
                .map(match => BigInt(`0x${match[1]}`));
            const va = values.filter(value => value >= 0x01000000n).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)[0];
            if (va !== undefined) { return va; }
        }
        return undefined;
    }

    protected exceptionName(vector: number): string {
        const names: Record<number, string> = {
            0: 'Divide error', 1: 'Debug', 2: 'Non-maskable interrupt', 3: 'Breakpoint', 4: 'Overflow',
            5: 'BOUND range exceeded', 6: 'Invalid opcode', 7: 'Device not available', 8: 'Double fault',
            10: 'Invalid TSS', 11: 'Segment not present', 12: 'Stack-segment fault', 13: 'General protection fault',
            14: 'Page fault', 16: 'x87 floating-point exception', 17: 'Alignment check', 18: 'Machine check',
            19: 'SIMD floating-point exception', 20: 'Virtualization exception', 21: 'Control protection exception'
        };
        return names[vector] ?? `CPU exception ${vector}`;
    }

    protected async buildDisassembly(session: RunSession, rip: bigint): Promise<InuDisassemblyInstruction[]> {
        if (session.relocationDelta === undefined || !session.nativeDebugMap?.image) { return []; }
        const linkedRip = rip - session.relocationDelta;
        const tool = path.join(INU_SDK_ROOT, '.toolchain', 'LLVM', 'bin', 'llvm-objdump.exe');
        if (!(await this.exists(tool)) || !(await this.exists(session.nativeDebugMap.image))) { return []; }
        const stop = linkedRip + 192n;
        const output = await this.captureTool(tool, [
            '-d', '--no-show-raw-insn', `--start-address=0x${linkedRip.toString(16)}`,
            `--stop-address=0x${stop.toString(16)}`, session.nativeDebugMap.image
        ]);
        if (output.exitCode !== 0) { return []; }
        const instructions: InuDisassemblyInstruction[] = [];
        for (const line of output.text.split(/\r?\n/)) {
            const match = line.match(/^\s*([0-9a-fA-F]+):\s*(.+?)\s*$/);
            if (!match) { continue; }
            const linked = BigInt(`0x${match[1]}`);
            const runtime = linked + session.relocationDelta;
            const location = this.resolveSourceLocation(session.nativeDebugMap, linked);
            instructions.push({
                runtimeAddress: `0x${runtime.toString(16)}`,
                linkedAddress: `0x${linked.toString(16)}`,
                instruction: match[2],
                sourcePath: location?.sourcePath,
                line: location?.line,
                current: linked === linkedRip
            });
            if (instructions.length >= 32) { break; }
        }
        return instructions;
    }

    protected async captureTool(command: string, args: string[]): Promise<{ exitCode: number; text: string }> {
        return new Promise(resolve => {
            const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            let text = '';
            child.stdout?.on('data', data => { text += data.toString(); });
            child.stderr?.on('data', data => { text += data.toString(); });
            child.once('error', error => resolve({ exitCode: 1, text: error.message }));
            child.once('close', code => resolve({ exitCode: code ?? 1, text }));
        });
    }

    protected resolveLinkedSourceAddress(debugMap: NativeDebugMap, sourcePath: string, line: number): ResolvedSourceAddress | undefined {
        const normalize = (value: string | undefined) => value ? path.resolve(value).replace(/\//g, '\\').toLowerCase() : '';
        const normalized = normalize(sourcePath);
        const basename = path.basename(normalized).toLowerCase();

        let entries = debugMap.entries.filter(entry => normalize(entry.sourcePath) === normalized);
        if (entries.length === 0) {
            const basenameMatches = debugMap.entries.filter(entry => path.basename(entry.sourcePath).toLowerCase() === basename);
            const distinctSources = new Set(basenameMatches.map(entry => normalize(entry.sourcePath)));
            if (distinctSources.size === 1) {
                entries = basenameMatches;
            }
        }
        if (entries.length === 0) {
            return undefined;
        }

        const exact = entries.find(entry => entry.line === line);
        if (exact) {
            return { linkedAddress: this.parseAddress(exact.linkedAddress), resolvedLine: exact.line, exactLine: true };
        }

        // C# debuggers bind non-executable lines (braces, declarations, comments, blank
        // lines) to the nearest useful sequence point. Prefer the next executable line,
        // which matches normal breakpoint behaviour, and only fall back a few lines.
        const forward = entries
            .filter(entry => entry.line > line && entry.line - line <= 8)
            .sort((a, b) => a.line - b.line || Number(this.parseAddress(a.linkedAddress) - this.parseAddress(b.linkedAddress)))[0];
        if (forward) {
            return { linkedAddress: this.parseAddress(forward.linkedAddress), resolvedLine: forward.line, exactLine: false };
        }

        const backward = entries
            .filter(entry => entry.line < line && line - entry.line <= 3)
            .sort((a, b) => b.line - a.line || Number(this.parseAddress(a.linkedAddress) - this.parseAddress(b.linkedAddress)))[0];
        return backward
            ? { linkedAddress: this.parseAddress(backward.linkedAddress), resolvedLine: backward.line, exactLine: false }
            : undefined;
    }

    protected async handleGdbStop(session: RunSession, packet: string): Promise<void> {
        const stoppedThread = /(?:^|;)thread:([^;]+)/i.exec(packet)?.[1];
        if (stoppedThread) { session.selectedThreadId = stoppedThread; }
        if (session.preparingAnchor) {
            session.anchorStopResolve?.();
            return;
        }
        if (session.internalPause) {
            session.debug = { ...(session.debug ?? { active: false, sourceSymbols: true }), active: false, paused: true, sourceSymbols: true, message: 'Debugger preparation pause.' };
            return;
        }
        if (!session.debug?.active) {
            return;
        }

        try {
            if (!session.gdb || session.relocationDelta === undefined || !session.nativeDebugMap) {
                session.debug = { ...session.debug, paused: true, message: 'Kernel stopped.' };
                return;
            }

            const rip = await this.readRip(session.gdb);
            const candidates = [rip, rip > 0n ? rip - 1n : rip];

            if (session.panicDebuggerBreakAddress && candidates.some(candidate => candidate === session.panicDebuggerBreakAddress)) {
                session.debug = {
                    ...session.debug,
                    paused: true,
                    exceptionVector: 3,
                    exceptionName: 'Kernel panic debugger break',
                    message: 'Kernel panic debugger break reached. A versioned NOCD crash dump is being captured before the configured halt/reboot policy continues.'
                };
                session.output += '[DEBUG STOP] Kernel panic debugger break reached.\r\n';
                await this.populatePausedDebugData(session, rip);
                const dump = await this.captureCrashDump(session.sessionId, 'Kernel panic');
                if (!dump.success) {
                    session.output += `[WARN] Automatic kernel-panic crash dump failed: ${dump.error}\r\n`;
                } else if (dump.dump) {
                    session.output += `[ OK ] Automatic kernel-panic crash dump: ${dump.dump.path}\r\n`;
                }
                return;
            }

            const exceptionHit = candidates
                .map(candidate => ({ address: candidate, vector: session.exceptionBreakpointAddresses.get(candidate) }))
                .find(item => item.vector !== undefined);
            if (exceptionHit?.vector !== undefined) {
                const vector = exceptionHit.vector;
                const rsp = await this.readRegister(session.gdb, 7);
                // InuX64InterruptDebugFrameN is reached only after every vector stub has normalized
                // its stack to [vector,error,RIP,CS,RFLAGS,(old RSP,old SS when switched)].  This
                // is also the exact layout consumed by InuX64InterruptCommon.
                const frameVector = await this.readU64(session.gdb, rsp);
                const errorCode = await this.readU64(session.gdb, rsp + 8n);
                const faultRip = await this.readU64(session.gdb, rsp + 16n);
                const faultCs = await this.readU64(session.gdb, rsp + 24n);
                const faultRflags = await this.readU64(session.gdb, rsp + 32n);
                if (frameVector !== BigInt(vector)) {
                    session.output += `[WARN] CPU exception debug-frame mismatch: armed vector ${vector}, normalized frame reports ${frameVector.toString()}.\r\n`;
                }
                let configuredStackSwitch = false;
                if (session.interruptStackSwitchAddress !== undefined) {
                    try {
                        const flag = await this.readMemory(session.gdb, session.interruptStackSwitchAddress + BigInt(vector), 1);
                        configuredStackSwitch = flag.length === 1 && flag[0] !== 0;
                    } catch { }
                }
                const stackSwitched = (faultCs & 3n) !== 0n || configuredStackSwitch;
                const interruptedRsp = stackSwitched ? await this.readU64(session.gdb, rsp + 40n) : rsp + 40n;
                const name = this.exceptionName(vector);
                const linkedFault = faultRip - session.relocationDelta;
                const location = this.resolveSourceLocation(session.nativeDebugMap, linkedFault);
                const stopMessage = `CPU exception breakpoint: ${name} (vector ${vector})${location ? ` at ${path.basename(location.sourcePath)}:${location.line}` : ` at RIP 0x${faultRip.toString(16)}`}.`;
                session.debug = {
                    ...session.debug, paused: true, sourcePath: location?.sourcePath, line: location?.line,
                    exceptionVector: vector, exceptionName: name,
                    faultInstructionPointer: `0x${faultRip.toString(16)}`,
                    message: stopMessage
                };
                session.output += `[DEBUG STOP] ${stopMessage}\r\n`;
                session.output += `[DEBUG STOP] Exception frame: error=0x${errorCode.toString(16)}, CS=0x${faultCs.toString(16)}, RFLAGS=0x${faultRflags.toString(16)}, interrupted RSP=0x${interruptedRsp.toString(16)}.\r\n`;
                try {
                    const faultBytes = await this.readMemory(session.gdb, faultRip, 16);
                    session.output += faultBytes.length === 16
                        ? `[DEBUG STOP] Fault instruction bytes @ 0x${faultRip.toString(16)}: ${faultBytes.toString('hex')}\r\n`
                        : `[WARN] Fault instruction bytes unavailable at 0x${faultRip.toString(16)}.\r\n`;
                } catch { }
                await this.populatePausedDebugData(session, faultRip, new Map<string, bigint>([
                    ['rip', faultRip], ['rsp', interruptedRsp], ['rflags', faultRflags]
                ]));
                const dump = await this.captureCrashDump(session.sessionId, `CPU exception: ${name} (vector ${vector})`);
                if (!dump.success) session.output += `[WARN] Automatic exception crash dump failed: ${dump.error}\r\n`;
                return;
            }

            if (session.panicBreakpointAddress && candidates.some(candidate => candidate === session.panicBreakpointAddress)) {
                session.debug = { ...session.debug, paused: true, exceptionName: 'Kernel fatal/panic stop', message: 'Kernel fatal/panic breakpoint reached before the processor halt loop.' };
                session.output += '[DEBUG STOP] Kernel fatal/panic breakpoint reached before the processor halt loop.\r\n';
                await this.populatePausedDebugData(session, rip);
                const dump = await this.captureCrashDump(session.sessionId, 'Kernel fatal/panic stop');
                if (!dump.success) session.output += `[WARN] Automatic panic crash dump failed: ${dump.error}\r\n`;
                return;
            }

            const hit = Array.from(session.breakpoints.values()).find(bp =>
                candidates.some(candidate => candidate === this.parseAddress(bp.address)));

            if (hit) {
                await this.clearTemporaryStepBreakpoint(session);
                session.stepPlan = undefined;
                hit.hitCount++;
                const result: InuBreakpointResult = {
                    success: true, verified: true, sourcePath: hit.sourcePath, line: hit.line,
                    resolvedLine: hit.resolvedLine, address: hit.address, condition: hit.condition,
                    hitCondition: hit.hitCondition, hitCount: hit.hitCount,
                    message: `Breakpoint armed; hit count ${hit.hitCount}.`
                };
                this.replaceBreakpointResult(session, result);

                const hitCountMatches = this.hitConditionMatches(hit.hitCondition, hit.hitCount);
                let conditionMatches = true;
                if (hit.condition && hitCountMatches) {
                    try {
                        conditionMatches = (await this.evaluateExpressionValue(session, hit.condition)) !== 0n;
                    } catch (error) {
                        session.lastBreakpoint = hit;
                        session.debug = {
                            ...session.debug, paused: true, sourcePath: hit.sourcePath, line: hit.resolvedLine,
                            message: `Breakpoint condition error at ${path.basename(hit.sourcePath)}:${hit.resolvedLine}: ${error instanceof Error ? error.message : String(error)}`
                        };
                        await this.populatePausedDebugData(session, rip);
                        return;
                    }
                }

                if (!hitCountMatches || !conditionMatches) {
                    const reason = !hitCountMatches
                        ? `hit ${hit.hitCount} does not match ${hit.hitCondition}`
                        : `condition "${hit.condition}" evaluated false`;
                    session.output += `[DEBUG] Breakpoint skipped at ${hit.sourcePath}:${hit.line}: ${reason}.\r\n`;
                    session.gdb.run('c');
                    session.debug = this.runningDebugState(session, `Kernel running. Breakpoint skipped (${reason}).`);
                    return;
                }

                session.lastBreakpoint = hit;
                const qualifiers = [hit.condition ? `condition: ${hit.condition}` : '', hit.hitCondition ? `hit rule: ${hit.hitCondition}, hit ${hit.hitCount}` : ''].filter(Boolean).join('; ');
                session.debug = {
                    ...session.debug,
                    paused: true,
                    sourcePath: hit.sourcePath,
                    line: hit.resolvedLine,
                    message: (hit.resolvedLine === hit.line
                        ? `Breakpoint reached at ${path.basename(hit.sourcePath)}:${hit.line}.`
                        : `Breakpoint reached at ${path.basename(hit.sourcePath)}:${hit.resolvedLine} (requested line ${hit.line}).`) + (qualifiers ? ` ${qualifiers}.` : '')
                };
                await this.populatePausedDebugData(session, rip);
                return;
            }

            if (session.stepPlan) {
                const plan = session.stepPlan;
                if (plan.temporaryAddress && candidates.some(candidate => candidate === plan.temporaryAddress)) {
                    await this.clearTemporaryStepBreakpoint(session);
                    if (plan.kind === 'step-out') {
                        session.stepPlan = undefined;
                        await this.publishPausedLocation(session, rip, 'Step Out completed.');
                        return;
                    }
                }

                const linkedRip = rip - session.relocationDelta;
                const location = this.resolveSourceLocation(session.nativeDebugMap, linkedRip);
                const changedSourceLine = !!location &&
                    (!plan.sourcePath || this.normalizeSourcePath(location.sourcePath) !== this.normalizeSourcePath(plan.sourcePath) || location.line !== plan.line);
                if (changedSourceLine) {
                    session.stepPlan = undefined;
                    await this.publishPausedLocation(session, rip, `${this.stepLabel(plan.kind)} completed.`);
                    return;
                }

                if (plan.machineSteps >= 20000) {
                    session.stepPlan = undefined;
                    await this.publishPausedLocation(session, rip, `${this.stepLabel(plan.kind)} stopped after the safety limit of 20,000 machine instructions.`);
                    return;
                }

                await this.advanceStepPlan(session, rip);
                return;
            }

            await this.publishPausedLocation(
                session,
                rip,
                packet.startsWith('T05') || packet.startsWith('S05') ? 'Kernel stopped.' : `Kernel stopped: ${packet}`
            );
        } catch (error) {
            session.stepPlan = undefined;
            session.debug = { ...session.debug, paused: true, message: `Kernel stopped; source/debug-state lookup failed: ${error instanceof Error ? error.message : String(error)}` };
        }
    }

    protected async publishPausedLocation(session: RunSession, rip: bigint, message: string): Promise<void> {
        if (!session.debug || session.relocationDelta === undefined || !session.nativeDebugMap) {
            return;
        }
        const linkedRip = rip - session.relocationDelta;
        const nearest = this.resolveSourceLocation(session.nativeDebugMap, linkedRip);
        session.debug = {
            ...session.debug,
            paused: true,
            sourcePath: nearest?.sourcePath,
            line: nearest?.line,
            message: nearest ? `${message} ${path.basename(nearest.sourcePath)}:${nearest.line}.` : message
        };
        await this.populatePausedDebugData(session, rip);
    }

    protected async advanceStepPlan(session: RunSession, knownRip?: bigint): Promise<void> {
        const plan = session.stepPlan;
        if (!plan || !session.gdb || !session.debug) {
            return;
        }
        plan.machineSteps++;

        if (plan.kind === 'step-over') {
            const rip = knownRip ?? await this.readRip(session.gdb);
            const instructionLength = await this.currentCallInstructionLength(session.gdb, rip);
            if (instructionLength > 0) {
                const afterCall = rip + BigInt(instructionLength);
                const reply = await session.gdb.command(`Z0,${afterCall.toString(16)},1`);
                if (reply === 'OK') {
                    plan.temporaryAddress = afterCall;
                    session.gdb.run('c');
                    session.debug = this.runningDebugState(session, 'Step Over running…');
                    return;
                }
            }
        }

        session.gdb.run('s');
        session.debug = this.runningDebugState(session, `${this.stepLabel(plan.kind)} running…`);
    }

    protected async clearTemporaryStepBreakpoint(session: RunSession): Promise<void> {
        const address = session.stepPlan?.temporaryAddress;
        if (!address || !session.gdb) {
            return;
        }
        try { await session.gdb.command(`z0,${address.toString(16)},1`); } catch { }
        if (session.stepPlan) {
            session.stepPlan.temporaryAddress = undefined;
        }
    }

    protected runningDebugState(session: RunSession, message: string): InuDebugState {
        return {
            ...(session.debug ?? { active: true, sourceSymbols: true }),
            active: true,
            paused: false,
            sourcePath: undefined,
            line: undefined,
            registers: undefined,
            callStack: undefined,
            locals: undefined,
            localsMessage: undefined,
            disassembly: undefined,
            exceptionVector: undefined,
            exceptionName: undefined,
            faultInstructionPointer: undefined,
            message
        };
    }

    protected stepLabel(kind: StepPlan['kind']): string {
        if (kind === 'step-into') { return 'Step Into'; }
        if (kind === 'step-over') { return 'Step Over'; }
        return 'Step Out';
    }


    protected replaceBreakpointResult(session: RunSession, result: InuBreakpointResult): void {
        const normalized = path.resolve(result.sourcePath).toLowerCase();
        session.breakpointResults = session.breakpointResults.filter(item => !(path.resolve(item.sourcePath).toLowerCase() === normalized && item.line === result.line));
        session.breakpointResults.push(result);
    }

    protected isValidHitCondition(value: string): boolean {
        const match = value.trim().match(/^(?:=|==|>=|<=|>|<|%)?\s*([1-9][0-9]*)$/);
        return !!match;
    }

    protected hitConditionMatches(value: string | undefined, hitCount: number): boolean {
        if (!value) { return true; }
        const match = value.trim().match(/^(=|==|>=|<=|>|<|%)?\s*([1-9][0-9]*)$/);
        if (!match) { return false; }
        const op = match[1] || '=';
        const target = Number(match[2]);
        if (op === '%') { return hitCount % target === 0; }
        if (op === '>') { return hitCount > target; }
        if (op === '>=') { return hitCount >= target; }
        if (op === '<') { return hitCount < target; }
        if (op === '<=') { return hitCount <= target; }
        return hitCount === target;
    }

    protected async evaluateExpressionValue(session: RunSession, expression: string): Promise<bigint> {
        if (!session.gdb) { throw new Error('QEMU debugger is not attached.'); }
        const registerNames = ['rax','rbx','rcx','rdx','rsi','rdi','rbp','rsp','r8','r9','r10','r11','r12','r13','r14','r15','rip','rflags'];
        const registerIndexes = new Map(registerNames.map((name, index) => [name, index]));
        const cache = new Map<string, bigint>();
        const parser = new InuExpressionParser(
            expression,
            async name => {
                const index = registerIndexes.get(name);
                if (index !== undefined) {
                    const cached = cache.get(name);
                    if (cached !== undefined) { return cached; }
                    const value = await this.readRegister(session.gdb!, index);
                    cache.set(name, value);
                    return value;
                }
                const named = await this.resolveNamedVariableValue(session, name);
                if (named !== undefined) { cache.set(name, named); }
                return named;
            },
            async address => this.readU64(session.gdb!, address)
        );
        return parser.evaluate();
    }

    protected async resolveNamedVariableValue(session: RunSession, name: string): Promise<bigint | undefined> {
        if (!session.gdb || session.relocationDelta === undefined) { return undefined; }
        await this.ensureNativeVariableMap(session);
        if (!session.nativeVariables?.length) { return undefined; }
        const rip = await this.readRegister(session.gdb, 16);
        const linkedRip = rip - session.relocationDelta;
        const variable = session.nativeVariables.find(item => item.name.toLowerCase() === name.toLowerCase() &&
            linkedRip >= item.functionStart && linkedRip < item.functionEnd &&
            (item.rangeStart === undefined || linkedRip >= item.rangeStart) &&
            (item.rangeEnd === undefined || linkedRip < item.rangeEnd));
        if (!variable) { return undefined; }
        if (variable.register) {
            const index = this.x64RegisterIndex(variable.register);
            return index === undefined ? undefined : this.readRegister(session.gdb, index);
        }
        if (variable.baseRegister) {
            const index = this.x64RegisterIndex(variable.baseRegister);
            if (index === undefined) { return undefined; }
            const base = await this.readRegister(session.gdb, index);
            return this.readU64(session.gdb, BigInt.asUintN(64, base + (variable.offset ?? 0n)));
        }
        return undefined;
    }

    protected normalizeSourcePath(sourcePath: string): string {
        return path.resolve(sourcePath).replace(/\\/g, '/').toLowerCase();
    }

    protected async currentCallInstructionLength(gdb: GdbRspClient, rip: bigint): Promise<number> {
        const bytes = await this.readMemory(gdb, rip, 15);
        if (bytes.length === 0) { return 0; }
        let i = 0;
        while (i < bytes.length && (bytes[i] === 0x66 || bytes[i] === 0x67 || bytes[i] === 0xf2 || bytes[i] === 0xf3 || (bytes[i] >= 0x40 && bytes[i] <= 0x4f))) { i++; }
        if (bytes[i] === 0xe8) { return i + 5; }
        if (bytes[i] !== 0xff || i + 1 >= bytes.length) { return 0; }
        const modrm = bytes[i + 1];
        const reg = (modrm >> 3) & 7;
        if (reg !== 2 && reg !== 3) { return 0; }
        let length = i + 2;
        const mod = (modrm >> 6) & 3;
        const rm = modrm & 7;
        if (mod !== 3 && rm === 4) {
            if (length >= bytes.length) { return 0; }
            const sib = bytes[length++];
            const base = sib & 7;
            if (mod === 0 && base === 5) { length += 4; }
        }
        if (mod === 0 && rm === 5) { length += 4; }
        else if (mod === 1) { length += 1; }
        else if (mod === 2) { length += 4; }
        return length <= bytes.length ? length : 0;
    }

    protected async populatePausedDebugData(session: RunSession, rip: bigint, registerOverrides?: ReadonlyMap<string, bigint>): Promise<void> {
        if (!session.gdb || !session.debug) { return; }
        const executionContexts = await this.readExecutionContexts(session);
        let registers = await this.readRegisterSet(session.gdb);
        if (registerOverrides?.size) {
            registers = registers.map(item => {
                const override = registerOverrides.get(item.name);
                return override === undefined ? item : { ...item, value: `0x${override.toString(16).padStart(16, '0')}` };
            });
        }
        const registerMap = new Map(registers.map(item => [item.name, this.parseAddress(item.value)]));
        const rbp = registerMap.get('rbp') ?? 0n;
        const rsp = registerMap.get('rsp') ?? 0n;
        const callStack = await this.readCallStack(session, rip, rbp, rsp, registerMap);
        const namedVariables = await this.readNamedNativeVariables(session, rip);
        const locals = namedVariables.length > 0 ? namedVariables : await this.readFrameSlots(session.gdb, rbp, rsp);
        const disassembly = await this.buildDisassembly(session, rip);
        session.debug = {
            ...session.debug,
            registers,
            callStack,
            executionContexts,
            selectedThreadId: session.selectedThreadId,
            locals,
            disassembly,
            localsMessage: namedVariables.length > 0
                ? (session.nativeVariablesMessage ?? 'Named C# arguments/locals resolved from NativeAOT CodeView/PDB variable records.')
                : (session.nativeVariablesMessage ?? 'No active named NativeAOT variable records were available at this instruction; showing native frame/stack slots instead.')
        };
    }

    protected resolveRuntimeSourceLocation(session: RunSession, runtimeAddress: bigint): NativeSourceLine | undefined {
        if (session.relocationDelta === undefined || !session.nativeDebugMap) { return undefined; }
        return this.resolveSourceLocation(session.nativeDebugMap, runtimeAddress - session.relocationDelta);
    }

    protected async readExecutionContexts(session: RunSession): Promise<InuDebugExecutionContext[]> {
        if (!session.gdb) { return []; }
        const ids: string[] = [];
        try {
            let reply = await session.gdb.command('qfThreadInfo');
            while (reply.startsWith('m')) {
                ids.push(...reply.slice(1).split(',').map(item => item.trim()).filter(Boolean));
                reply = await session.gdb.command('qsThreadInfo');
            }
        } catch { }
        let current = session.selectedThreadId;
        if (!current) {
            try {
                const currentReply = await session.gdb.command('qC');
                if (currentReply.startsWith('QC')) { current = currentReply.slice(2); }
            } catch { }
        }
        if (ids.length === 0 && current) { ids.push(current); }
        const contexts: InuDebugExecutionContext[] = [];
        for (let index = 0; index < ids.length; index++) {
            const id = ids[index];
            let name = `CPU ${index} / thread ${id}`;
            try {
                const extra = await session.gdb.command(`qThreadExtraInfo,${id}`);
                if (/^[0-9a-f]+$/i.test(extra) && extra.length % 2 === 0) {
                    const decoded = Buffer.from(extra, 'hex').toString('utf8').replace(/\0/g, '').trim();
                    if (decoded) { name = decoded; }
                }
            } catch { }
            const match = /^p([0-9a-f]+)\.([0-9a-f]+)$/i.exec(id);
            contexts.push({
                id,
                threadId: match ? match[2] : id,
                processId: match ? match[1] : undefined,
                cpuIndex: index,
                name,
                current: !!current && id.toLowerCase() === current.toLowerCase()
            });
        }
        if (!session.selectedThreadId && current) { session.selectedThreadId = current; }
        return contexts;
    }

    protected async readRegisterSet(gdb: GdbRspClient): Promise<InuDebugRegister[]> {
        const names = ['rax','rbx','rcx','rdx','rsi','rdi','rbp','rsp','r8','r9','r10','r11','r12','r13','r14','r15','rip','rflags'];
        const values: InuDebugRegister[] = [];
        for (let i = 0; i < names.length; i++) {
            const value = await this.readRegister(gdb, i);
            values.push({ name: names[i], value: `0x${value.toString(16).padStart(16, '0')}` });
        }
        return values;
    }

    protected async readCallStack(session: RunSession, rip: bigint, initialRbp: bigint, rsp: bigint, registerMap: Map<string, bigint>): Promise<InuDebugFrame[]> {
        const frames: InuDebugFrame[] = [];
        const addFrame = (address: bigint, index: number, unwoundBy: 'x64-unwind' | 'leaf') => {
            const location = this.resolveRuntimeSourceLocation(session, address);
            frames.push({
                index,
                address: `0x${address.toString(16)}`,
                label: location ? `${path.basename(location.sourcePath)}:${location.line}` : `native 0x${address.toString(16)}`,
                sourcePath: location?.sourcePath,
                line: location?.line,
                kind: location ? 'managed' : 'native',
                unwoundBy
            });
        };
        addFrame(rip, 0, 'x64-unwind');
        if (!session.gdb || rsp === 0n || session.relocationDelta === undefined) { return frames; }

        const table = await this.ensurePeUnwindTable(session);
        if (!table) {
            // Do not fall back to scanning arbitrary stack words: that creates false frames.
            return frames;
        }

        const context = new Map(registerMap);
        context.set('rip', rip);
        context.set('rsp', rsp);
        context.set('rbp', initialRbp);
        const seen = new Set<string>();
        for (let index = 1; index < 64; index++) {
            const currentRip = context.get('rip') ?? 0n;
            let currentRsp = context.get('rsp') ?? 0n;
            if (currentRip === 0n || currentRsp === 0n) { break; }
            const signature = `${currentRip.toString(16)}:${currentRsp.toString(16)}`;
            if (seen.has(signature)) { break; }
            seen.add(signature);

            const linked = currentRip - session.relocationDelta;
            const rvaBig = linked - table.imageBase;
            if (rvaBig < 0n || rvaBig > 0xffffffffn) { break; }
            const rva = Number(rvaBig);
            const entry = table.entries.find(item => rva >= item.beginRva && rva < item.endRva);
            let method: 'x64-unwind' | 'leaf' = 'leaf';
            if (entry) {
                method = 'x64-unwind';
                const nextRsp = await this.applyX64UnwindInfo(session.gdb, table, entry.unwindRva, context);
                if (nextRsp === undefined) { break; }
                currentRsp = nextRsp;
            }

            const returnAddress = await this.readU64(session.gdb, currentRsp);
            if (returnAddress === 0n) { break; }
            context.set('rip', returnAddress);
            context.set('rsp', currentRsp + 8n);
            addFrame(returnAddress, index, method);
        }
        return frames;
    }

    protected async ensurePeUnwindTable(session: RunSession): Promise<PeUnwindTable | undefined> {
        if (session.unwindTableLoaded) { return session.unwindTable; }
        session.unwindTableLoaded = true;
        try {
            const image = session.nativeDebugMap?.image ?? path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel', 'MinimalKernel.bin');
            const bytes = await fs.readFile(image);
            if (bytes.length < 0x100 || bytes.toString('ascii', 0, 2) !== 'MZ') { return undefined; }
            const pe = bytes.readUInt32LE(0x3c);
            if (pe + 0x100 >= bytes.length || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0') { return undefined; }
            const sectionCount = bytes.readUInt16LE(pe + 6);
            const optionalSize = bytes.readUInt16LE(pe + 20);
            const optional = pe + 24;
            const magic = bytes.readUInt16LE(optional);
            if (magic !== 0x20b) { return undefined; }
            const imageBase = bytes.readBigUInt64LE(optional + 24);
            const exceptionRva = bytes.readUInt32LE(optional + 112 + 3 * 8);
            const exceptionSize = bytes.readUInt32LE(optional + 112 + 3 * 8 + 4);
            const sectionTable = optional + optionalSize;
            const sections: PeSectionInfo[] = [];
            for (let i = 0; i < sectionCount; i++) {
                const o = sectionTable + i * 40;
                sections.push({
                    virtualSize: bytes.readUInt32LE(o + 8),
                    virtualAddress: bytes.readUInt32LE(o + 12),
                    rawSize: bytes.readUInt32LE(o + 16),
                    rawOffset: bytes.readUInt32LE(o + 20)
                });
            }
            const rvaToOffset = (rva: number): number | undefined => {
                for (const section of sections) {
                    const size = Math.max(section.virtualSize, section.rawSize);
                    if (rva >= section.virtualAddress && rva < section.virtualAddress + size) {
                        return section.rawOffset + (rva - section.virtualAddress);
                    }
                }
                return rva < bytes.length ? rva : undefined;
            };
            const exceptionOffset = rvaToOffset(exceptionRva);
            if (exceptionOffset === undefined) { return undefined; }
            const entries: PeUnwindEntry[] = [];
            const count = Math.floor(exceptionSize / 12);
            for (let i = 0; i < count; i++) {
                const o = exceptionOffset + i * 12;
                if (o + 12 > bytes.length) { break; }
                const beginRva = bytes.readUInt32LE(o);
                const endRva = bytes.readUInt32LE(o + 4);
                const unwindRva = bytes.readUInt32LE(o + 8);
                if (beginRva && endRva > beginRva && unwindRva) { entries.push({ beginRva, endRva, unwindRva }); }
            }
            entries.sort((a, b) => a.beginRva - b.beginRva);
            session.unwindTable = { imageBase, bytes, sections, entries };
            return session.unwindTable;
        } catch {
            return undefined;
        }
    }

    protected peRvaToOffset(table: PeUnwindTable, rva: number): number | undefined {
        for (const section of table.sections) {
            const size = Math.max(section.virtualSize, section.rawSize);
            if (rva >= section.virtualAddress && rva < section.virtualAddress + size) {
                const offset = section.rawOffset + (rva - section.virtualAddress);
                return offset < table.bytes.length ? offset : undefined;
            }
        }
        return rva < table.bytes.length ? rva : undefined;
    }

    protected x64UnwindRegisterName(index: number): string | undefined {
        return ['rax','rcx','rdx','rbx','rsp','rbp','rsi','rdi','r8','r9','r10','r11','r12','r13','r14','r15'][index];
    }

    protected async applyX64UnwindInfo(gdb: GdbRspClient, table: PeUnwindTable, unwindRva: number, context: Map<string, bigint>, depth = 0): Promise<bigint | undefined> {
        if (depth > 8) { return undefined; }
        const offset = this.peRvaToOffset(table, unwindRva);
        if (offset === undefined || offset + 4 > table.bytes.length) { return undefined; }
        const versionFlags = table.bytes[offset];
        const flags = versionFlags >> 3;
        const countCodes = table.bytes[offset + 2];
        const frameByte = table.bytes[offset + 3];
        const frameRegisterIndex = frameByte & 0x0f;
        const frameOffset = (frameByte >> 4) * 16;
        let virtualRsp = context.get('rsp') ?? 0n;
        let slot = 0;
        const codeBase = offset + 4;
        while (slot < countCodes) {
            const co = codeBase + slot * 2;
            if (co + 2 > table.bytes.length) { return undefined; }
            const opByte = table.bytes[co + 1];
            const unwindOp = opByte & 0x0f;
            const opInfo = opByte >> 4;
            slot++;
            if (unwindOp === 0) { // UWOP_PUSH_NONVOL
                const reg = this.x64UnwindRegisterName(opInfo);
                if (reg) { context.set(reg, await this.readU64(gdb, virtualRsp)); }
                virtualRsp += 8n;
            } else if (unwindOp === 1) { // UWOP_ALLOC_LARGE
                if (opInfo === 0) {
                    const oo = codeBase + slot * 2;
                    if (oo + 2 > table.bytes.length) { return undefined; }
                    virtualRsp += BigInt(table.bytes.readUInt16LE(oo) * 8);
                    slot += 1;
                } else {
                    const oo = codeBase + slot * 2;
                    if (oo + 4 > table.bytes.length) { return undefined; }
                    virtualRsp += BigInt(table.bytes.readUInt32LE(oo));
                    slot += 2;
                }
            } else if (unwindOp === 2) { // UWOP_ALLOC_SMALL
                virtualRsp += BigInt(opInfo * 8 + 8);
            } else if (unwindOp === 3) { // UWOP_SET_FPREG
                const reg = this.x64UnwindRegisterName(frameRegisterIndex);
                const frameValue = reg ? context.get(reg) : undefined;
                if (frameValue !== undefined) { virtualRsp = frameValue - BigInt(frameOffset); }
            } else if (unwindOp === 4 || unwindOp === 8) { // SAVE_NONVOL / SAVE_XMM128
                const oo = codeBase + slot * 2;
                if (oo + 2 > table.bytes.length) { return undefined; }
                if (unwindOp === 4) {
                    const reg = this.x64UnwindRegisterName(opInfo);
                    if (reg) { context.set(reg, await this.readU64(gdb, virtualRsp + BigInt(table.bytes.readUInt16LE(oo) * 8))); }
                }
                slot += 1;
            } else if (unwindOp === 5 || unwindOp === 9) { // FAR saves
                const oo = codeBase + slot * 2;
                if (oo + 4 > table.bytes.length) { return undefined; }
                if (unwindOp === 5) {
                    const reg = this.x64UnwindRegisterName(opInfo);
                    if (reg) { context.set(reg, await this.readU64(gdb, virtualRsp + BigInt(table.bytes.readUInt32LE(oo)))); }
                }
                slot += 2;
            } else if (unwindOp === 10) { // UWOP_PUSH_MACHFRAME
                virtualRsp += BigInt(opInfo === 0 ? 40 : 48);
            }
        }
        context.set('rsp', virtualRsp);

        // UNW_FLAG_CHAININFO: continue through the chained runtime function's unwind metadata.
        if ((flags & 0x4) !== 0) {
            const alignedSlots = (countCodes + 1) & ~1;
            const chained = codeBase + alignedSlots * 2;
            if (chained + 12 <= table.bytes.length) {
                const chainedUnwindRva = table.bytes.readUInt32LE(chained + 8);
                const chainedRsp = await this.applyX64UnwindInfo(gdb, table, chainedUnwindRva, context, depth + 1);
                if (chainedRsp !== undefined) { virtualRsp = chainedRsp; }
            }
        }
        return virtualRsp;
    }

    protected async readNamedNativeVariables(session: RunSession, rip: bigint): Promise<InuDebugVariable[]> {
        if (!session.gdb || session.relocationDelta === undefined) { return []; }
        await this.ensureNativeVariableMap(session);
        if (!session.nativeVariables || session.nativeVariables.length === 0) { return []; }
        const linkedRip = rip - session.relocationDelta;
        const active = session.nativeVariables.filter(variable =>
            linkedRip >= variable.functionStart && linkedRip < variable.functionEnd &&
            (variable.rangeStart === undefined || linkedRip >= variable.rangeStart) &&
            (variable.rangeEnd === undefined || linkedRip < variable.rangeEnd));
        const result: InuDebugVariable[] = [];
        const seen = new Set<string>();
        for (const variable of active) {
            const key = `${variable.kind}:${variable.name}`;
            if (seen.has(key)) { continue; }
            seen.add(key);
            let value: bigint | undefined;
            let location = '';
            if (variable.register) {
                const registerIndex = this.x64RegisterIndex(variable.register);
                if (registerIndex !== undefined) {
                    value = await this.readRegister(session.gdb, registerIndex);
                    location = variable.register.toLowerCase();
                }
            } else if (variable.baseRegister) {
                const registerIndex = this.x64RegisterIndex(variable.baseRegister);
                if (registerIndex !== undefined) {
                    const base = await this.readRegister(session.gdb, registerIndex);
                    const address = BigInt.asUintN(64, base + (variable.offset ?? 0n));
                    value = await this.readU64(session.gdb, address);
                    const signedOffset = variable.offset ?? 0n;
                    location = `[${variable.baseRegister.toLowerCase()}${signedOffset < 0n ? `-0x${(-signedOffset).toString(16)}` : `+0x${signedOffset.toString(16)}`}]`;
                }
            }
            result.push({
                name: variable.name,
                kind: variable.kind,
                value: value === undefined ? '<location unavailable>' : `0x${BigInt.asUintN(64, value).toString(16).padStart(16, '0')}`,
                location: location || undefined,
                typeName: variable.typeName
            });
        }
        return result;
    }

    protected async ensureNativeVariableMap(session: RunSession): Promise<void> {
        if (session.nativeVariables !== undefined) { return; }
        session.nativeVariables = [];
        const pdb = session.nativeDebugMap?.pdb ?? path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel', 'MinimalKernel.pdb');
        const image = session.nativeDebugMap?.image ?? path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel', 'MinimalKernel.bin');
        const pdbutil = path.join(INU_SDK_ROOT, '.toolchain', 'LLVM', 'bin', 'llvm-pdbutil.exe');
        if (!(await this.exists(pdbutil))) {
            session.nativeVariablesMessage = 'llvm-pdbutil is not installed in the bundled LLVM toolchain, so named NativeAOT locals cannot be resolved; native frame slots are shown instead.';
            return;
        }
        if (!(await this.exists(pdb)) || !(await this.exists(image))) {
            session.nativeVariablesMessage = 'Native debug PDB/kernel image is unavailable, so named locals cannot be resolved.';
            return;
        }
        const layout = await this.readPeImageLayout(image);
        if (!layout) {
            session.nativeVariablesMessage = 'The linked kernel image layout could not be read for NativeAOT local-variable address resolution.';
            return;
        }
        const output = await this.captureTool(pdbutil, ['dump', '--symbols', pdb]);
        if (output.exitCode !== 0) {
            session.nativeVariablesMessage = `llvm-pdbutil could not read NativeAOT variable records: ${output.text.trim().slice(0, 240)}`;
            return;
        }
        session.nativeVariables = this.parseNativeVariableRecords(output.text, layout);
        session.nativeVariablesMessage = session.nativeVariables.length > 0
            ? `Named NativeAOT locals/arguments enabled (${session.nativeVariables.length} live-range record(s) loaded from MinimalKernel.pdb).`
            : 'MinimalKernel.pdb contains source lines but no usable NativeAOT local-variable live-range records; native frame slots are shown instead.';
    }

    protected async readPeImageLayout(image: string): Promise<PeImageLayout | undefined> {
        try {
            const bytes = await fs.readFile(image);
            if (bytes.length < 0x100 || bytes.readUInt16LE(0) !== 0x5a4d) { return undefined; }
            const pe = bytes.readUInt32LE(0x3c);
            if (pe + 0x108 > bytes.length || bytes.readUInt32LE(pe) !== 0x00004550) { return undefined; }
            const sectionCount = bytes.readUInt16LE(pe + 6);
            const optionalSize = bytes.readUInt16LE(pe + 20);
            const optional = pe + 24;
            if (bytes.readUInt16LE(optional) !== 0x20b) { return undefined; }
            const imageBase = bytes.readBigUInt64LE(optional + 24);
            const sections = new Map<number, bigint>();
            const sectionTable = optional + optionalSize;
            for (let index = 0; index < sectionCount; index++) {
                const offset = sectionTable + index * 40;
                if (offset + 40 > bytes.length) { break; }
                sections.set(index + 1, imageBase + BigInt(bytes.readUInt32LE(offset + 12)));
            }
            return { imageBase, sections };
        } catch { return undefined; }
    }

    protected parseNativeVariableRecords(text: string, layout: PeImageLayout): NativeVariableLocation[] {
        const records = text.split(/(?=^\s*\d+\s+\|\s+S_)/m);
        const result: NativeVariableLocation[] = [];
        let functionStart: bigint | undefined;
        let functionEnd: bigint | undefined;
        let currentLocal: { name: string; kind: 'local' | 'argument'; typeName?: string } | undefined;
        let frameRegister = 'rbp';
        const linkedAddress = (sectionText: string, offsetText: string): bigint | undefined => {
            const section = Number.parseInt(sectionText, 10);
            const base = layout.sections.get(section);
            if (base === undefined) { return undefined; }
            return base + BigInt(`0x${offsetText}`);
        };
        for (const record of records) {
            const kindMatch = record.match(/^\s*\d+\s+\|\s+(S_[A-Z0-9_]+)/m);
            const kind = kindMatch?.[1] ?? '';
            if (kind === 'S_GPROC32' || kind === 'S_LPROC32' || kind === 'S_GPROC32_ID' || kind === 'S_LPROC32_ID') {
                const proc = record.match(/addr\s*=\s*([0-9]+):([0-9a-fA-F]+),\s*code size\s*=\s*(\d+)/i);
                functionStart = proc ? linkedAddress(proc[1], proc[2]) : undefined;
                functionEnd = functionStart !== undefined && proc ? functionStart + BigInt(proc[3]) : undefined;
                frameRegister = 'rbp';
                currentLocal = undefined;
                continue;
            }
            if (kind === 'S_END') {
                currentLocal = undefined;
                continue;
            }
            if (kind === 'S_FRAMEPROC') {
                const fp = record.match(/(?:local|param) fp reg\s*=\s*([A-Za-z0-9]+)/i);
                if (fp) { frameRegister = fp[1].toLowerCase(); }
                continue;
            }
            if (kind === 'S_LOCAL') {
                const name = record.match(/`([^`]+)`/)?.[1];
                if (!name) { currentLocal = undefined; continue; }
                const flagsText = record.match(/flags\s*=\s*([^\r\n]+)/i)?.[1] ?? '';
                const typeName = record.match(/type\s*=\s*`([^`]+)`/i)?.[1];
                currentLocal = { name, kind: /param/i.test(flagsText) ? 'argument' : 'local', typeName };
                continue;
            }
            if (!currentLocal || functionStart === undefined || functionEnd === undefined) { continue; }
            const range = record.match(/range\s*=\s*\[([0-9]+):([0-9a-fA-F]+),\s*\+?\s*(?:0x)?([0-9a-fA-F]+)\)/i);
            const rangeStart = range ? linkedAddress(range[1], range[2]) : undefined;
            const rangeLength = range ? BigInt(`0x${range[3]}`) : undefined;
            const rangeEnd = rangeStart !== undefined && rangeLength !== undefined ? rangeStart + rangeLength : undefined;
            if (kind === 'S_DEFRANGE_REGISTER' || kind === 'S_DEFRANGE_SUBFIELD_REGISTER') {
                const register = record.match(/register\s*=\s*([A-Za-z][A-Za-z0-9]*)/i)?.[1];
                if (register) result.push({ ...currentLocal, functionStart, functionEnd, rangeStart, rangeEnd, register: register.toLowerCase() });
                continue;
            }
            if (kind === 'S_DEFRANGE_REGISTER_REL') {
                const register = record.match(/register\s*=\s*([A-Za-z][A-Za-z0-9]*)/i)?.[1];
                const offsetText = record.match(/offset\s*=\s*(-?(?:0x)?[0-9a-fA-F]+)/i)?.[1];
                if (register && offsetText) result.push({ ...currentLocal, functionStart, functionEnd, rangeStart, rangeEnd, baseRegister: register.toLowerCase(), offset: this.parseSignedInteger(offsetText) });
                continue;
            }
            if (kind === 'S_DEFRANGE_FRAMEPOINTER_REL' || kind === 'S_DEFRANGE_FRAMEPOINTER_REL_FULL_SCOPE') {
                const offsetText = record.match(/offset\s*=\s*(-?(?:0x)?[0-9a-fA-F]+)/i)?.[1];
                if (offsetText) result.push({ ...currentLocal, functionStart, functionEnd, rangeStart, rangeEnd, baseRegister: frameRegister, offset: this.parseSignedInteger(offsetText) });
            }
        }
        return result;
    }

    protected parseSignedInteger(text: string): bigint {
        const trimmed = text.trim().toLowerCase();
        const negative = trimmed.startsWith('-');
        const body = negative ? trimmed.slice(1) : trimmed;
        const value = body.startsWith('0x') ? BigInt(body) : /^\d+$/.test(body) ? BigInt(body) : BigInt(`0x${body}`);
        return negative ? -value : value;
    }

    protected x64RegisterIndex(name: string): number | undefined {
        const names = ['rax','rbx','rcx','rdx','rsi','rdi','rbp','rsp','r8','r9','r10','r11','r12','r13','r14','r15','rip','rflags'];
        const index = names.indexOf(name.toLowerCase().replace(/^cv_/, ''));
        return index >= 0 ? index : undefined;
    }

    protected async readFrameSlots(gdb: GdbRspClient, rbp: bigint, rsp: bigint): Promise<InuDebugVariable[]> {
        const result: InuDebugVariable[] = [];
        if (rbp !== 0n) {
            for (let offset = -0x40; offset <= -0x08; offset += 8) {
                const address = rbp + BigInt(offset);
                const value = await this.readU64(gdb, address);
                result.push({ name: `[rbp${offset.toString(16)}]`, value: `0x${value.toString(16).padStart(16, '0')}`, kind: 'local' });
            }
            for (let offset = 0x10; offset <= 0x30; offset += 8) {
                const value = await this.readU64(gdb, rbp + BigInt(offset));
                result.push({ name: `[rbp+0x${offset.toString(16)}]`, value: `0x${value.toString(16).padStart(16, '0')}`, kind: 'argument' });
            }
        } else if (rsp !== 0n) {
            for (let offset = 0; offset <= 0x40; offset += 8) {
                const value = await this.readU64(gdb, rsp + BigInt(offset));
                result.push({ name: `[rsp+0x${offset.toString(16)}]`, value: `0x${value.toString(16).padStart(16, '0')}`, kind: 'stack' });
            }
        }
        return result;
    }

    protected async readRegister(gdb: GdbRspClient, index: number): Promise<bigint> {
        const reply = await gdb.command(`p${index.toString(16)}`);
        if (!/^[0-9a-fA-F]+$/.test(reply) || reply.length < 2) {
            throw new Error(`QEMU returned an invalid register value for p${index.toString(16)}: ${reply}`);
        }
        const bytes = reply.match(/../g) ?? [];
        return BigInt(`0x${bytes.reverse().join('')}`);
    }

    protected async readMemory(gdb: GdbRspClient, address: bigint, length: number): Promise<Buffer> {
        const reply = await gdb.command(`m${address.toString(16)},${length.toString(16)}`);
        if (reply.startsWith('E') || !/^[0-9a-fA-F]*$/.test(reply) || reply.length % 2 !== 0) {
            return Buffer.alloc(0);
        }
        return Buffer.from(reply, 'hex');
    }

    protected async readU64(gdb: GdbRspClient, address: bigint): Promise<bigint> {
        const bytes = await this.readMemory(gdb, address, 8);
        if (bytes.length !== 8) { return 0n; }
        let value = 0n;
        for (let i = 7; i >= 0; i--) { value = (value << 8n) | BigInt(bytes[i]); }
        return value;
    }

    protected formatAddress(value: bigint): string {
        return `0x${BigInt.asUintN(64, value).toString(16).padStart(16, '0')}`;
    }

    protected safeNumber(value: bigint): number {
        const max = BigInt(Number.MAX_SAFE_INTEGER);
        return Number(value > max ? max : value < 0n ? 0n : value);
    }

    protected async qemuMonitor(gdb: GdbRspClient, monitorCommand: string): Promise<string> {
        const encoded = Buffer.from(monitorCommand, 'utf8').toString('hex');
        const reply = await gdb.command(`qRcmd,${encoded}`);
        if (/^E[0-9a-f]+$/i.test(reply)) throw new Error(`QEMU monitor rejected "${monitorCommand}": ${reply}`);
        return reply;
    }

    protected async readPhysicalU64(gdb: GdbRspClient, physicalAddress: bigint): Promise<bigint> {
        const output = await this.qemuMonitor(gdb, `xp /1gx 0x${physicalAddress.toString(16)}`);
        const values = Array.from(output.matchAll(/0x([0-9a-fA-F]{1,16})/g)).map(match => BigInt(`0x${match[1]}`));
        if (values.length === 0) throw new Error(`QEMU could not read physical memory at ${this.formatAddress(physicalAddress)}.`);
        // HMP prints the requested address followed by the value. If both are prefixed with 0x,
        // the last 64-bit value is the memory contents.
        return values[values.length - 1];
    }

    protected async readMemoryChunked(gdb: GdbRspClient, address: bigint, length: number, chunkSize = 512): Promise<Buffer> {
        const parts: Buffer[] = [];
        let offset = 0;
        while (offset < length) {
            const count = Math.min(chunkSize, length - offset);
            const part = await this.readMemory(gdb, address + BigInt(offset), count);
            if (part.length !== count) break;
            parts.push(part);
            offset += count;
        }
        return Buffer.concat(parts);
    }

    protected async ensureNativeGlobalSymbols(session: RunSession): Promise<void> {
        if (session.nativeGlobalsLoaded) return;
        session.nativeGlobalsLoaded = true;
        session.nativeGlobals = [];
        const pdb = session.nativeDebugMap?.pdb ?? path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel', 'MinimalKernel.pdb');
        const image = session.nativeDebugMap?.image ?? path.join(INU_SDK_ROOT, 'Artifacts', 'MinimalKernel', 'MinimalKernel.bin');
        const pdbutil = path.join(INU_SDK_ROOT, '.toolchain', 'LLVM', 'bin', 'llvm-pdbutil.exe');
        if (await this.exists(pdbutil) && await this.exists(pdb) && await this.exists(image)) {
            const layout = await this.readPeImageLayout(image);
            if (layout) {
                const output = await this.captureTool(pdbutil, ['dump', '--symbols', pdb]);
                if (output.exitCode === 0) session.nativeGlobals.push(...this.parseNativeGlobalSymbols(output.text, layout));
            }
        }
        // Some NativeAOT toolchain revisions omit static data from CodeView but retain it in the linker map.
        // Supplement the PDB with any KernelHeap data symbols that can be recognized there.
        try {
            const mapText = await fs.readFile(session.nativeDebugMap?.map ?? '', 'utf8');
            for (const suffix of ['_state', '_committed', '_allocated', '_peak', '_live', '_initialized', '_status']) {
                if (this.findHeapGlobal(session, suffix)) continue;
                for (const line of mapText.split(/\r?\n/)) {
                    if (!/KernelHeap/i.test(line) || !line.includes(suffix)) continue;
                    const values = Array.from(line.matchAll(/(?:0x)?([0-9a-fA-F]{8,16})/g)).map(match => BigInt(`0x${match[1]}`));
                    const linkedAddress = values.find(value => value >= 0x01000000n);
                    if (linkedAddress !== undefined) {
                        session.nativeGlobals.push({ name: `KernelHeap${suffix}`, linkedAddress });
                        break;
                    }
                }
            }
            for (const [component, suffixes] of [
                ['KernelInterruptDispatch', ['_initialized','_localApicBase','_callbacks','_cookies','_allocated']],
                ['KernelInterruptBroker', ['_initialized','_localApic','_ioApic','_x2Apic','_routes','_capacity','_count','_ioApics','_ioApicCount']],
                ['KernelSystemCalls', ['_registry','_initialized','_smapEnabled','_stateAddress','_stackBase','_stackTop','_configuredProcessors']]
            ] as Array<[string,string[]]>) {
                for (const suffix of suffixes) {
                    if (this.findKernelGlobal(session, component, suffix)) continue;
                    for (const line of mapText.split(/\r?\n/)) {
                        if (!line.includes(component) || !line.includes(suffix)) continue;
                        const values = Array.from(line.matchAll(/(?:0x)?([0-9a-fA-F]{8,16})/g)).map(match => BigInt(`0x${match[1]}`));
                        const linkedAddress = values.find(value => value >= 0x01000000n);
                        if (linkedAddress !== undefined) { session.nativeGlobals.push({ name: `${component}${suffix}`, linkedAddress }); break; }
                    }
                }
            }
        } catch { }
    }

    protected parseNativeGlobalSymbols(text: string, layout: PeImageLayout): NativeGlobalSymbol[] {
        const records = text.split(/(?=^\s*\d+\s+\|\s+S_)/m);
        const result: NativeGlobalSymbol[] = [];
        for (const record of records) {
            if (!/^\s*\d+\s+\|\s+S_(?:GDATA32|LDATA32)/m.test(record)) continue;
            const addr = /addr\s*=\s*([0-9]+):([0-9a-fA-F]+)/i.exec(record);
            const name = /`([^`]+)`/.exec(record)?.[1];
            if (!addr || !name) continue;
            const sectionBase = layout.sections.get(Number.parseInt(addr[1], 10));
            if (sectionBase === undefined) continue;
            result.push({ name, linkedAddress: sectionBase + BigInt(`0x${addr[2]}`) });
        }
        return result;
    }

    protected findKernelGlobal(session: RunSession, component: string, suffix: string): NativeGlobalSymbol | undefined {
        const globals = session.nativeGlobals ?? [];
        const c=component.toLowerCase(), s=suffix.toLowerCase();
        return globals.find(item => item.name.toLowerCase().includes(c) && item.name.toLowerCase().endsWith(s))
            ?? globals.find(item => item.name.toLowerCase().includes(c) && item.name.toLowerCase().includes(s));
    }

    protected findHeapGlobal(session: RunSession, suffix: string): NativeGlobalSymbol | undefined {
        const globals = session.nativeGlobals ?? [];
        const exactish = globals.find(item => /KernelHeap/i.test(item.name) && item.name.toLowerCase().endsWith(suffix.toLowerCase()));
        if (exactish) return exactish;
        return globals.find(item => /KernelHeap/i.test(item.name) && item.name.toLowerCase().includes(suffix.toLowerCase()));
    }

    protected isWithinDebugMap(debugMap: NativeDebugMap, linkedAddress: bigint): boolean {
        if (debugMap.entries.length === 0) { return false; }
        let min = this.parseAddress(debugMap.entries[0].linkedAddress);
        let max = min;
        for (const entry of debugMap.entries) {
            const address = this.parseAddress(entry.linkedAddress);
            if (address < min) { min = address; }
            if (address > max) { max = address; }
        }
        return linkedAddress >= min && linkedAddress <= max + 0x10000n;
    }

    protected resolveSourceLocation(debugMap: NativeDebugMap, linkedAddress: bigint): NativeSourceLine | undefined {
        let nearest: NativeSourceLine | undefined;
        let nearestAddress = -1n;
        for (const entry of debugMap.entries) {
            const address = this.parseAddress(entry.linkedAddress);
            if (address <= linkedAddress && address > nearestAddress) {
                nearest = entry;
                nearestAddress = address;
            }
        }
        return nearest;
    }

    protected async waitForDebugRendezvous(session: RunSession, debugConLog: string, timeoutMs: number): Promise<bigint> {
        const magic = Buffer.from('NODBG64!', 'ascii');
        const until = Date.now() + timeoutMs;
        let lastByteCount = 0;
        let loaderTrace = '';
        let nextSerialProbeAt = 0;
        while (Date.now() < until) {
            try {
                const data = await fs.readFile(debugConLog);
                lastByteCount = data.length;
                loaderTrace = data.toString('latin1').replace(/[^\x20-\x7e\r\n]/g, '.').slice(-768).trim();
                const index = data.indexOf(magic);
                if (index >= 0 && data.length >= index + magic.length + 8) {
                    const bytes = data.subarray(index + magic.length, index + magic.length + 8);
                    let address = 0n;
                    for (let i = 7; i >= 0; i--) { address = (address << 8n) | BigInt(bytes[i]); }
                    if (address !== 0n) { return address; }
                }
            } catch { }
            if (session.serialLogPath && Date.now() >= nextSerialProbeAt) {
                nextSerialProbeAt = Date.now() + 200;
                try {
                    const serial = await fs.readFile(session.serialLogPath, 'utf8');
                    if (serial.includes('[[INU:INTERACTIVE_READY]]'))
                        throw new Error('The Debug guest reached the interactive shell before publishing NODBG64!. Kath detected a non-debug/stale kernel image and stopped the debugger launch immediately.');
                } catch (error) {
                    if (error instanceof Error && error.message.includes('interactive shell before publishing NODBG64!')) throw error;
                }
            }
            const qemuExit = session.qemu?.exitCode;
            const qemuSignal = session.qemu?.signalCode;
            if (qemuExit !== null && qemuExit !== undefined) {
                throw new Error(`QEMU exited with code ${qemuExit} before the Inu debug rendezvous was published. Debugcon bytes: ${lastByteCount}.${loaderTrace ? ` Bootloader trace: ${loaderTrace}` : ""}`);
            }
            if (qemuSignal) {
                throw new Error(`QEMU terminated with signal ${qemuSignal} before the Inu debug rendezvous was published. Debugcon bytes: ${lastByteCount}.${loaderTrace ? ` Bootloader trace: ${loaderTrace}` : ""}`);
            }
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        let serialBytes = 0;
        if (session.serialLogPath) {
            try { serialBytes = (await fs.stat(session.serialLogPath)).size; } catch { }
        }
        throw new Error(`Inu debug rendezvous was not published within ${Math.ceil(timeoutMs / 1000)} seconds. Debugcon bytes: ${lastByteCount}; serial bytes: ${serialBytes}.${loaderTrace ? ` Bootloader trace: ${loaderTrace}` : ""}`);
    }

    protected async waitForDebugCheckpoint(debugConLog: string, tag: string, timeoutMs: number): Promise<boolean> {
        const magic = Buffer.from(tag, 'ascii');
        const until = Date.now() + timeoutMs;
        while (Date.now() < until) {
            try {
                const data = await fs.readFile(debugConLog);
                if (data.indexOf(magic) >= 0) { return true; }
            } catch { }
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        return false;
    }

    protected async writeRip(gdb: GdbRspClient, value: bigint): Promise<void> {
        let hex = value.toString(16).padStart(16, '0');
        const bytes = hex.match(/../g) ?? [];
        hex = bytes.reverse().join('');
        const reply = await gdb.command(`P10=${hex}`);
        if (reply !== 'OK') { throw new Error(`QEMU rejected the debugger resume RIP: ${reply}`); }
    }

    protected async readRip(gdb: GdbRspClient): Promise<bigint> {
        return this.readRegister(gdb, 16);
    }

    protected parseAddress(value: string): bigint {
        const trimmed = value.trim().replace(/^0x/i, '');
        return BigInt(`0x${trimmed || '0'}`);
    }

    protected formatSignedHex(value: bigint): string {
        return value < 0n ? `-0x${(-value).toString(16)}` : `+0x${value.toString(16)}`;
    }

    protected async waitForPause(session: RunSession, timeoutMs: number): Promise<void> {
        const until = Date.now() + timeoutMs;
        while (Date.now() < until) {
            if (session.debug?.paused) { return; }
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        // QEMU's all-stop gdbstub is request/response driven and may suppress unsolicited
        // stop notifications. Querying '?' is the protocol-defined way to recover the stop
        // reason after a connection-time pause or Ctrl-C when no asynchronous packet arrived.
        if (session.gdb) {
            try {
                const stopReply = await session.gdb.command('?');
                if (/^[TS]/.test(stopReply)) {
                    if (!session.debug?.paused) {
                        session.debug = { ...(session.debug ?? { active: false, sourceSymbols: true }), paused: true, sourceSymbols: true, message: session.internalPause ? 'Debugger preparation pause.' : 'Kernel paused.' };
                    }
                    return;
                }
                if (/^[WX]/.test(stopReply)) {
                    throw new Error(`Debugger target exited while waiting for pause: ${stopReply}`);
                }
            } catch (error) {
                if (error instanceof Error && error.message.startsWith('Debugger target exited')) { throw error; }
            }
        }
        throw new Error('Debugger transport did not acknowledge the pause request after both the stop notification wait and an RSP stop-reason query.');
    }

    protected async findFreePort(start: number, end: number): Promise<number> {
        for (let port = start; port <= end; port++) {
            if (await new Promise<boolean>(resolve => {
                const server = net.createServer();
                server.once('error', () => resolve(false));
                server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
            })) { return port; }
        }
        throw new Error(`No free QEMU control port was found between ${start} and ${end}.`);
    }

    protected async exists(filePath: string): Promise<boolean> {
        try { await fs.access(filePath); return true; } catch { return false; }
    }

}
