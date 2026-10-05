import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { MessageService } from '@theia/core/lib/common';
import {
    InuPhysicalDebuggerProbe,
    InuProjectService,
    InuTargetProfile
} from '../common/inu-protocol';

@injectable()
export class InuPhysicalDebuggerWidget extends ReactWidget {
    static readonly ID = 'inu.physical.debugger.transport';
    static readonly LABEL = 'Inu Physical-machine Debugger';

    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    @inject(MessageService) protected readonly messages!: MessageService;

    protected targets: InuTargetProfile[] = [];
    protected activeTargetId = '';
    protected probing = false;
    protected probe?: InuPhysicalDebuggerProbe;

    @postConstruct()
    protected init(): void {
        this.id = InuPhysicalDebuggerWidget.ID;
        this.title.label = InuPhysicalDebuggerWidget.LABEL;
        this.title.caption = 'Attach the Inu debugger to a real x64 machine over GDB RSP';
        this.title.closable = true;
        this.addClass('inu-physical-debugger-widget');
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => void this.refresh()));
        void this.refresh();
    }

    protected root(): string | undefined { return this.workspaceService.workspace?.resource.path.fsPath(); }
    protected physicalTargets(): InuTargetProfile[] { return this.targets.filter(target => target.kind === 'physical'); }
    protected selected(): InuTargetProfile | undefined {
        return this.targets.find(target => target.id === this.activeTargetId && target.kind === 'physical')
            ?? this.physicalTargets()[0];
    }

    async refresh(): Promise<void> {
        const root = this.root();
        this.probe = undefined;
        if (!root) { this.targets = []; this.activeTargetId = ''; this.update(); return; }
        try {
            const state = await this.projectService.listTargets(root);
            this.targets = state.targets;
            this.activeTargetId = state.activeTargetId;
        } catch {
            this.targets = [];
            this.activeTargetId = '';
        }
        this.update();
    }

    protected async testTransport(target: InuTargetProfile): Promise<void> {
        const root = this.root(); if (!root) return;
        this.probing = true; this.probe = undefined; this.update();
        try {
            this.probe = await this.projectService.probePhysicalDebugger(root, target.id);
            if (this.probe.success) await this.messages.info(this.probe.message ?? 'Physical debugger transport is reachable.');
            else await this.messages.warn(this.probe.error ?? 'Physical debugger transport is not reachable.');
        } finally {
            this.probing = false; this.update();
        }
    }

    protected async activateTarget(target: InuTargetProfile): Promise<void> {
        const root = this.root(); if (!root) return;
        const result = await this.projectService.setActiveTarget(root, target.id);
        if (!result.success) { await this.messages.error(result.error ?? 'Could not activate physical target.'); return; }
        this.targets = result.state!.targets;
        this.activeTargetId = result.state!.activeTargetId;
        this.probe = undefined;
        this.update();
    }

    protected render(): React.ReactNode {
        const physical = this.physicalTargets();
        const selected = this.selected();
        return <div className='inu-tool-page'>
            <div className='inu-tool-header'>
                <div><h2>Physical-machine Debugger Transport</h2><p>Debug the same Inu NativeAOT kernel on real x64 hardware using the GDB Remote Serial Protocol.</p></div>
                <button className='theia-button' onClick={() => void this.refresh()}>Refresh</button>
            </div>
            {!this.root() && <p>Open a Inu operating system first.</p>}
            {this.root() && physical.length === 0 && <section className='inu-target-note'><h3>No physical target configured</h3><p>Open <strong>Inu → Engineering → Target Manager</strong>, add a <strong>Physical machine</strong> target, and enter the hardware debugger/GDB-stub host and port. Serial capture is optional.</p></section>}
            {physical.length > 0 && <>
                <section><h3>Physical Targets <span className='inu-count'>{physical.length}</span></h3>
                    <div className='inu-target-list'>{physical.map(target => <div className={`inu-target-card ${target.id === this.activeTargetId ? 'active' : ''}`} key={target.id}>
                        <div className='inu-target-card-title'><strong>{target.name}</strong>{target.id === this.activeTargetId && <span className='inu-target-active'>ACTIVE</span>}</div>
                        <div className='inu-target-meta'>{target.architecture} · GDB {target.physical?.gdbHost}:{target.physical?.gdbPort}{target.physical?.serialPort ? ` · serial ${target.physical.serialPort}@${target.physical.baudRate ?? 115200}` : ''}</div>
                        <div className='inu-target-actions'>
                            {target.id !== this.activeTargetId && <button className='theia-button' onClick={() => void this.activateTarget(target)}>Use Target</button>}
                            <button className='theia-button main' disabled={this.probing} onClick={() => void this.testTransport(target)}>{this.probing ? 'Testing…' : 'Test GDB Transport'}</button>
                        </div>
                    </div>)}</div>
                </section>
                {selected && <section className='inu-target-note'><h3>Debug workflow</h3>
                    <p><strong>1.</strong> Select <strong>{selected.name}</strong> as the active target. <strong>2.</strong> Press the IDE Debug/Run button in <strong>Debug</strong> mode. The IDE builds the current Debug image and waits up to 30 seconds for the configured GDB endpoint. <strong>3.</strong> Boot that freshly-built Inu image on the physical machine. The Debug kernel waits at <code>InuDebugImageAnchor</code> before <code>KMain</code>. <strong>4.</strong> The IDE reads the runtime anchor from x64 <code>R9</code>, resolves EFI relocation, arms C# source/exception/panic breakpoints, rewrites RIP to <code>InuDebugResume</code>, and continues.</p>
                    <p>The transport supports Pause, Continue, Step, register/memory inspection, source breakpoints, page-table/memory-map/APIC/syscall explorers, panic/exception breakpoints, and crash dumps through the same debugger core used by QEMU.</p>
                </section>}
                {this.probe && <section className={`inu-target-note ${this.probe.success ? '' : 'warning'}`}><h3>Transport Test</h3><p>{this.probe.success ? this.probe.message : this.probe.error}</p>{this.probe.stopReply && <p>GDB stop reply: <code>{this.probe.stopReply}</code></p>}</section>}
            </>}
        </div>;
    }
}
