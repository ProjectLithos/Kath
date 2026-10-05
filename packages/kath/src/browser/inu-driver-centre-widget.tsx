import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuCreateDriverRequest, InuDriverCapability, InuDriverDescriptor, InuDriverTemplateKind, InuProjectService } from '../common/inu-protocol';

@injectable()
export class InuDriverCentreWidget extends ReactWidget {
    static readonly ID = 'inu.driver.centre';
    static readonly LABEL = 'Inu Driver Centre';
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    @inject(MessageService) protected readonly messages!: MessageService;
    protected drivers: InuDriverDescriptor[] = [];
    protected loading = false;
    protected name = '';
    protected kind: InuDriverTemplateKind = 'pci';
    protected vendorId = '';
    protected deviceId = '';
    protected usbVendorId = '';
    protected usbProductId = '';
    protected virtioDeviceId = '1';
    protected capabilities = new Set<InuDriverCapability>(['mmio', 'interrupts']);
    protected createTestProject = true;

    @postConstruct() protected init(): void {
        this.id = InuDriverCentreWidget.ID;
        this.title.label = InuDriverCentreWidget.LABEL;
        this.title.caption = 'Driver templates, device IDs, capabilities and driver tests';
        this.title.closable = true;
        this.addClass('inu-driver-centre-widget');
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => void this.refresh()));
        void this.refresh();
    }

    protected root(): string | undefined { return this.workspaceService.workspace?.resource.path.fsPath(); }
    async refresh(): Promise<void> {
        const root = this.root(); if (!root) { this.drivers = []; this.update(); return; }
        this.loading = true; this.update();
        this.drivers = await this.projectService.listDrivers(root).catch(() => []);
        this.loading = false; this.update();
    }

    protected toggleCapability(value: InuDriverCapability): void {
        if (this.capabilities.has(value)) this.capabilities.delete(value); else this.capabilities.add(value);
        this.capabilities = new Set(this.capabilities); this.update();
    }

    protected async create(): Promise<void> {
        const root = this.root(); if (!root) return;
        const request: InuCreateDriverRequest = {
            name: this.name, kind: this.kind, vendorId: this.vendorId, deviceId: this.deviceId,
            usbVendorId: this.usbVendorId, usbProductId: this.usbProductId,
            virtioDeviceId: Number.parseInt(this.virtioDeviceId, 10), capabilities: [...this.capabilities],
            createTestProject: this.createTestProject
        };
        const result = await this.projectService.createDriver(root, request);
        if (!result.success) { await this.messages.error(result.error || 'Driver creation failed.'); return; }
        await this.messages.info(`Created Inu driver project: ${result.projectPath}`);
        this.name = ''; await this.refresh();
    }

    protected field(label: string, value: string, onChange: (value: string) => void, placeholder?: string): React.ReactNode {
        return <label className='inu-driver-field'><span>{label}</span><input value={value} placeholder={placeholder} onChange={e => { onChange(e.target.value); this.update(); }} /></label>;
    }

    protected render(): React.ReactNode {
        const caps: InuDriverCapability[] = ['mmio','pio','interrupts','msi','msix','dma','pci-config','physical-memory','timers','networking','filesystem'];
        return <div className='inu-tool-page'>
            <div className='inu-tool-header'><div><h2>Driver Development Centre</h2><p>Create Inu driver projects with explicit device IDs, SDK/ABI metadata, capabilities and individual test programs.</p></div><button className='theia-button' onClick={() => void this.refresh()}>Refresh</button></div>
            {!this.root() && <p>Open a Inu operating system to develop drivers.</p>}
            {this.root() && <>
                <section className='inu-driver-create'><h3>New Driver</h3>
                    <div className='inu-driver-grid'>{this.field('Driver name', this.name, v => this.name = v, 'Example: MyEthernet')}
                        <label className='inu-driver-field'><span>Template</span><select value={this.kind} onChange={e => { this.kind = e.target.value as InuDriverTemplateKind; this.update(); }}><option value='pci'>PCI / PCIe</option><option value='usb'>USB</option><option value='virtio'>VirtIO</option><option value='platform'>Platform</option></select></label>
                        {this.kind === 'pci' && <>{this.field('PCI Vendor ID', this.vendorId, v => this.vendorId = v, '0x8086')}{this.field('PCI Device ID', this.deviceId, v => this.deviceId = v, '0x100E')}</>}
                        {this.kind === 'usb' && <>{this.field('USB Vendor ID', this.usbVendorId, v => this.usbVendorId = v, '0x1234')}{this.field('USB Product ID', this.usbProductId, v => this.usbProductId = v, '0x5678')}</>}
                        {this.kind === 'virtio' && this.field('VirtIO Device ID', this.virtioDeviceId, v => this.virtioDeviceId = v, '1')}
                    </div>
                    <div className='inu-driver-capabilities'><strong>Declared capabilities</strong>{caps.map(cap => <label key={cap}><input type='checkbox' checked={this.capabilities.has(cap)} onChange={() => this.toggleCapability(cap)} />{cap.toUpperCase()}</label>)}</div>
                    <label className='inu-driver-test-option'><input type='checkbox' checked={this.createTestProject} onChange={e => { this.createTestProject = e.target.checked; this.update(); }} />Create an individual Test Explorer project</label>
                    <button className='theia-button main' disabled={!this.name.trim()} onClick={() => void this.create()}>Create Driver Project</button>
                </section>
                <section><h3>Driver Inventory <span className='inu-count'>{this.drivers.length}</span></h3>{this.loading && <p>Scanning drivers…</p>}
                    <div className='inu-driver-list'>{this.drivers.map(driver => <div className='inu-driver-card' key={driver.id}><div><strong>{driver.name}</strong><span className='inu-driver-kind'>{driver.kind}</span>{driver.configured && <span className='inu-driver-configured'>configured</span>}</div><small>{driver.projectPath}</small>{driver.manifest && <div className='inu-driver-meta'>API {driver.manifest.sdkApiVersion} · Driver ABI {driver.manifest.driverAbiVersion} · {driver.manifest.capabilities.join(', ') || 'no capabilities'}</div>}</div>)}</div>
                </section>
                <section className='inu-driver-runtime'><h3>Runtime inspection</h3><p>MMIO ranges, IRQ/MSI/MSI-X routing and DMA mappings are inspected from the Inu Debug and Hardware views when the kernel is paused. The Driver Centre keeps the driver's declared maximum privilege set and device IDs alongside that runtime state. Inu Kernel issues concrete capability grants only after the driver is bound to a matching device.</p></section>
            </>}
        </div>;
    }
}
