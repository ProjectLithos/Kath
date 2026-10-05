import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import {
    InuProjectService,
    InuTargetKind,
    InuTargetProfile,
    InuTargetArchitecture,
    InuQemuAccelerator,
    InuQemuDisplay
} from '../common/inu-protocol';

@injectable()
export class InuTargetManagerWidget extends ReactWidget {
    static readonly ID = 'inu.target.manager';
    static readonly LABEL = 'Inu Target Manager';

    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    @inject(MessageService) protected readonly messages!: MessageService;

    protected targets: InuTargetProfile[] = [];
    protected activeTargetId = '';
    protected loading = false;
    protected name = 'QEMU x64';
    protected kind: InuTargetKind = 'qemu';
    protected architecture: InuTargetArchitecture = 'x86_64';
    protected cpuCount = Math.max(1, Math.ceil((navigator.hardwareConcurrency || 2) / 2));
    protected memoryMiB = 512;
    protected machine = 'q35';
    protected accelerator: InuQemuAccelerator = 'tcg';
    protected display: InuQemuDisplay = 'sdl';
    protected gdbHost = '127.0.0.1';
    protected gdbPort = 1234;
    protected serialPort = 'COM1';
    protected baudRate = 115200;

    @postConstruct()
    protected init(): void {
        this.id = InuTargetManagerWidget.ID;
        this.title.label = InuTargetManagerWidget.LABEL;
        this.title.caption = 'Manage QEMU, physical and remote Inu execution targets';
        this.title.closable = true;
        this.addClass('inu-target-manager-widget');
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => void this.refresh()));
        void this.refresh();
    }

    protected root(): string | undefined { return this.workspaceService.workspace?.resource.path.fsPath(); }

    async refresh(): Promise<void> {
        const root = this.root();
        if (!root) { this.targets = []; this.activeTargetId = ''; this.update(); return; }
        this.loading = true; this.update();
        try {
            const state = await this.projectService.listTargets(root);
            this.targets = state.targets;
            this.activeTargetId = state.activeTargetId;
        } catch {
            this.targets = [];
            this.activeTargetId = '';
        }
        this.loading = false; this.update();
    }

    protected slug(value: string): string {
        return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `target-${Date.now().toString(36)}`;
    }

    protected async save(): Promise<void> {
        const root = this.root();
        if (!root || !this.name.trim()) return;
        const id = this.slug(this.name);
        const target: InuTargetProfile = {
            schemaVersion: 1,
            id,
            name: this.name.trim(),
            kind: this.kind,
            architecture: this.architecture,
            qemu: this.kind === 'qemu' ? {
                cpuCount: Math.max(1, Math.trunc(this.cpuCount || 1)),
                memoryMiB: Math.max(64, Math.trunc(this.memoryMiB || 512)),
                machine: this.machine.trim() || 'q35',
                accelerator: this.accelerator,
                display: this.display
            } : undefined,
            physical: this.kind === 'physical' ? {
                gdbHost: this.gdbHost.trim() || '127.0.0.1',
                gdbPort: Math.max(1, Math.min(65535, Math.trunc(this.gdbPort || 1234))),
                serialPort: this.serialPort.trim() || undefined,
                baudRate: Math.max(1200, Math.trunc(this.baudRate || 115200))
            } : undefined,
            remote: this.kind === 'remote' ? {
                host: this.gdbHost.trim() || '127.0.0.1',
                port: Math.max(1, Math.min(65535, Math.trunc(this.gdbPort || 1234)))
            } : undefined
        };
        const result = await this.projectService.saveTarget(root, target);
        if (!result.success) { await this.messages.error(result.error || 'Could not save target.'); return; }
        this.targets = result.state!.targets;
        this.activeTargetId = result.state!.activeTargetId;
        await this.messages.info(`Saved Inu target: ${target.name}`);
        this.update();
    }

    protected async setActiveTarget(id: string): Promise<void> {
        const root = this.root(); if (!root) return;
        const result = await this.projectService.setActiveTarget(root, id);
        if (!result.success) { await this.messages.error(result.error || 'Could not select target.'); return; }
        this.targets = result.state!.targets;
        this.activeTargetId = result.state!.activeTargetId;
        this.update();
    }

    protected async remove(id: string): Promise<void> {
        const root = this.root(); if (!root) return;
        const result = await this.projectService.deleteTarget(root, id);
        if (!result.success) { await this.messages.error(result.error || 'Could not delete target.'); return; }
        this.targets = result.state!.targets;
        this.activeTargetId = result.state!.activeTargetId;
        this.update();
    }

    protected field(label: string, value: string | number, onChange: (value: string) => void, type = 'text'): React.ReactNode {
        return <label className='inu-target-field'><span>{label}</span><input type={type} value={value} onChange={e => { onChange(e.target.value); this.update(); }} /></label>;
    }

    protected render(): React.ReactNode {
        return <div className='inu-tool-page'>
            <div className='inu-tool-header'><div><h2>Target Manager</h2><p>Define, persist and select the machine Inu builds, runs and debugs against.</p></div><button className='theia-button' onClick={() => void this.refresh()}>Refresh</button></div>
            {!this.root() && <p>Open a Inu operating system to manage its targets.</p>}
            {this.root() && <>
                <section className='inu-target-create'><h3>Add / Replace Target</h3>
                    <div className='inu-target-grid'>
                        {this.field('Target name', this.name, v => this.name = v)}
                        <label className='inu-target-field'><span>Kind</span><select value={this.kind} onChange={e => { this.kind = e.target.value as InuTargetKind; this.update(); }}><option value='qemu'>QEMU</option><option value='physical'>Physical machine</option><option value='remote'>Remote debugger</option></select></label>
                        <label className='inu-target-field'><span>Architecture</span><select value={this.architecture} onChange={e => { this.architecture = e.target.value as InuTargetArchitecture; this.update(); }}><option value='x86_64'>x86_64</option><option value='arm64'>ARM64</option><option value='riscv64'>RISC-V 64</option></select></label>
                        {this.kind === 'qemu' && <>
                            {this.field('Virtual CPUs', this.cpuCount, v => this.cpuCount = Number(v), 'number')}
                            {this.field('RAM (MiB)', this.memoryMiB, v => this.memoryMiB = Number(v), 'number')}
                            {this.field('QEMU machine', this.machine, v => this.machine = v)}
                            <label className='inu-target-field'><span>Accelerator</span><select value={this.accelerator} onChange={e => { this.accelerator = e.target.value as InuQemuAccelerator; this.update(); }}><option value='tcg'>TCG</option><option value='whpx'>WHPX</option><option value='auto'>Auto</option></select></label>
                            <label className='inu-target-field'><span>Display</span><select value={this.display} onChange={e => { this.display = e.target.value as InuQemuDisplay; this.update(); }}><option value='sdl'>SDL</option><option value='gtk'>GTK</option><option value='none'>None</option></select></label>
                        </>}
                        {this.kind !== 'qemu' && <>
                            {this.field(this.kind === 'physical' ? 'GDB host' : 'Remote host', this.gdbHost, v => this.gdbHost = v)}
                            {this.field(this.kind === 'physical' ? 'GDB port' : 'Remote port', this.gdbPort, v => this.gdbPort = Number(v), 'number')}
                        </>}
                        {this.kind === 'physical' && <>{this.field('Serial port', this.serialPort, v => this.serialPort = v)}{this.field('Baud rate', this.baudRate, v => this.baudRate = Number(v), 'number')}</>}
                    </div>
                    <button className='theia-button main' disabled={!this.name.trim()} onClick={() => void this.save()}>Save Target</button>
                </section>
                <section><h3>Targets <span className='inu-count'>{this.targets.length}</span></h3>{this.loading && <p>Loading targets…</p>}
                    <div className='inu-target-list'>{this.targets.map(target => <div className={`inu-target-card ${target.id === this.activeTargetId ? 'active' : ''}`} key={target.id}>
                        <div className='inu-target-card-title'><strong>{target.name}</strong>{target.id === this.activeTargetId && <span className='inu-target-active'>ACTIVE</span>}</div>
                        <div className='inu-target-meta'>{target.kind} · {target.architecture}{target.qemu ? ` · ${target.qemu.cpuCount} CPU · ${target.qemu.memoryMiB} MiB · ${target.qemu.machine} · ${target.qemu.accelerator}` : ''}</div>
                        <div className='inu-target-actions'>{target.id !== this.activeTargetId && <button className='theia-button' onClick={() => void this.setActiveTarget(target.id)}>Use Target</button>}<button className='theia-button secondary' disabled={this.targets.length <= 1} onClick={() => void this.remove(target.id)}>Delete</button></div>
                    </div>)}</div>
                </section>
                <section className='inu-target-note'><h3>Execution contract</h3><p>QEMU x86_64 targets support Run and Debug. Physical x86_64 targets support Debug through the Inu 0.10.11 GDB RSP physical-machine transport, with optional COM-port serial capture. ARM64/RISC-V and generic remote-agent execution remain stored/configurable until their architecture/transport backends are installed.</p></section>
            </>}
        </div>;
    }
}
