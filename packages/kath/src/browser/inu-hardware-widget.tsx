import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuDeviceTreeNode, InuDeviceTreeSnapshot, InuProjectService } from '../common/inu-protocol';

@injectable()
export class InuHardwareWidget extends ReactWidget {
    static readonly ID = 'inu.hardware.document';
    static readonly LABEL = 'Hardware / Device Tree';
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    protected snapshot?: InuDeviceTreeSnapshot;
    protected deviceTree: InuDeviceTreeNode[] = [];
    protected loading = false;

    @postConstruct() protected init(): void {
        this.id = InuHardwareWidget.ID; this.title.label = InuHardwareWidget.LABEL;
        this.title.caption = 'Inu hardware and driver configuration tree'; this.title.closable = true;
        this.addClass('inu-hardware-widget'); this.update();
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => void this.refresh()));
        void this.refresh();
    }
    async refresh(): Promise<void> {
        const workspace = this.workspaceService.workspace;
        if (!workspace) { this.snapshot = undefined; this.deviceTree = []; this.update(); return; }
        this.loading = true; this.update();
        this.snapshot = await this.projectService.inspectDeviceTree(workspace.resource.path.fsPath());
        this.deviceTree = this.snapshot.roots;
        this.loading = false; this.update();
    }
    protected renderDeviceNode(n: InuDeviceTreeNode): React.ReactNode {
        return <details open className='inu-hardware-group' key={n.id}><summary><span className='codicon codicon-circuit-board'></span>{n.name}<span className='inu-count'>{n.children.length}</span></summary>
            <div className='inu-hardware-children'>{n.children.length ? n.children.map(c => this.renderDeviceNode(c)) : <div className='inu-hardware-node'><span className='codicon codicon-circle-outline'></span><span>{n.bus}</span><small>{n.state}</small></div>}</div>
        </details>;
    }
    protected group(title: string, icon: string, entries: string[]): React.ReactNode {
        return <details open className='inu-hardware-group'><summary><span className={`codicon codicon-${icon}`}></span>{title}<span className='inu-count'>{entries.length}</span></summary>
            <div className='inu-hardware-children'>{entries.length ? entries.map(item => <div className='inu-hardware-node' key={item}><span className='codicon codicon-circuit-board'></span><span>{item}</span><small>configured</small></div>) : <div className='inu-hardware-empty'>None configured</div>}</div>
        </details>;
    }
    protected render(): React.ReactNode {
        const snapshot = this.snapshot;
        return <div className='inu-tool-page'>
            <div className='inu-tool-header'><div><h2>Hardware / Device Tree</h2><p>The same unified PCI, USB, ACPI, platform, virtual and logical device model exposed by Inu.Kernel.Drivers.</p></div><button className='theia-button' onClick={() => void this.refresh()}>Refresh</button></div>
            {this.loading && <p>Loading hardware configuration…</p>}
            {!this.loading && (!snapshot || !snapshot.roots.length) && <p>{snapshot?.message || 'Open a Inu operating system to inspect its device tree.'}</p>}
            {snapshot && snapshot.roots.length > 0 && <><p className='inu-tool-summary'>{snapshot.counts.total} device nodes — PCI {snapshot.counts.pci}, USB {snapshot.counts.usb}, ACPI {snapshot.counts.acpi}, platform {snapshot.counts.platform}, virtual {snapshot.counts.virtual}, logical {snapshot.counts.logical}.</p><div className='inu-hardware-tree'>{this.deviceTree.map(n => this.renderDeviceNode(n))}</div></>}
        </div>;
    }
}
