import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuMemoryMapRegion, InuMemoryMapSnapshot, InuMemoryRegionCategory, InuProjectService } from '../common/inu-protocol';

@injectable()
export class InuMemoryMapVisualizerWidget extends ReactWidget {
    static readonly ID = 'inu.memory.map.visualizer';
    static readonly LABEL = 'Inu Memory Map';

    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;

    protected projectPath: string | undefined;
    protected snapshot: InuMemoryMapSnapshot | undefined;
    protected loading = false;
    protected category: InuMemoryRegionCategory | 'all' = 'all';
    protected filter = '';

    @postConstruct()
    protected init(): void {
        this.id = InuMemoryMapVisualizerWidget.ID;
        this.title.label = InuMemoryMapVisualizerWidget.LABEL;
        this.title.caption = 'Visualise the retained final UEFI memory map from a paused Inu kernel';
        this.title.closable = true;
        this.addClass('inu-memory-map-widget');
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => {
            this.projectPath = this.workspaceService.workspace?.resource.path.fsPath();
            this.snapshot = undefined;
            this.update();
        }));
        this.update();
    }

    setProjectPath(projectPath: string | undefined): void {
        const normalized = projectPath?.trim() || undefined;
        if (this.projectPath === normalized) return;
        this.projectPath = normalized;
        this.snapshot = undefined;
        this.update();
    }

    protected root(): string | undefined {
        return this.workspaceService.workspace?.resource.path.fsPath() ?? this.projectPath;
    }

    async refresh(): Promise<void> {
        const root = this.root();
        if (!root) { this.snapshot = undefined; this.update(); return; }
        this.loading = true; this.update();
        try { this.snapshot = await this.projectService.inspectMemoryMap(root); }
        finally { this.loading = false; this.update(); }
    }

    protected formatBytes(value?: number): string {
        if (value === undefined) return '—';
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
        if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
        return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
    }

    protected categoryLabel(category: InuMemoryRegionCategory): string {
        return ({
            usable: 'Usable', 'boot-reclaimable': 'Boot reclaimable', runtime: 'Runtime', 'acpi-reclaimable': 'ACPI reclaimable',
            'acpi-nvs': 'ACPI NVS', mmio: 'MMIO', reserved: 'Reserved', unusable: 'Unusable', persistent: 'Persistent',
            unaccepted: 'Unaccepted', unknown: 'Unknown'
        } as Record<InuMemoryRegionCategory, string>)[category];
    }

    protected visibleRegions(): InuMemoryMapRegion[] {
        const needle = this.filter.trim().toLowerCase();
        return (this.snapshot?.regions ?? []).filter(region =>
            (this.category === 'all' || region.category === this.category) &&
            (!needle || region.typeName.toLowerCase().includes(needle) || region.physicalStart.toLowerCase().includes(needle) || region.physicalEnd.toLowerCase().includes(needle) || region.attributes.toLowerCase().includes(needle)));
    }

    protected renderTrack(regions: InuMemoryMapRegion[]): React.ReactNode {
        const total = regions.reduce((sum, region) => sum + region.byteCount, 0);
        if (!total) return <p>No regions match the current filter.</p>;
        return <div className='inu-memory-track' title='Descriptor widths are proportional to described bytes; physical-address gaps are not shown.'>
            {regions.map(region => {
                const width = Math.max(0.35, (region.byteCount / total) * 100);
                return <div key={region.index} className={`inu-memory-segment cat-${region.category}`} style={{ width: `${width}%` }} title={`${region.typeName}\n${region.physicalStart} – ${region.physicalEnd}\n${this.formatBytes(region.byteCount)}`} />;
            })}
        </div>;
    }

    protected render(): React.ReactNode {
        const root = this.root(); const snapshot = this.snapshot; const regions = this.visibleRegions();
        const categories: Array<InuMemoryRegionCategory | 'all'> = ['all','usable','boot-reclaimable','runtime','acpi-reclaimable','acpi-nvs','mmio','reserved','unusable','persistent','unaccepted','unknown'];
        return <div className='inu-tool-page inu-memory-map-page'>
            <div className='inu-tool-header'><div><h2>Memory-map Visualiser</h2><p>Inspect the exact final UEFI memory descriptors retained by Inu after ExitBootServices, directly from paused kernel memory.</p></div><button className='theia-button' disabled={!root || this.loading} onClick={() => void this.refresh()}>{this.loading ? 'Reading…' : 'Read Memory Map'}</button></div>
            {!root && <p>Open a Inu operating system to inspect its memory map.</p>}
            {root && !snapshot && <section className='inu-memory-help'><h3>Runtime memory map</h3><p>Run the OS in <strong>Debug</strong>, continue into the kernel, pause it, then choose <strong>Read Memory Map</strong>. The visualiser reads InuBootContext and the retained firmware descriptor buffer through the debugger rather than guessing from build-time RAM settings.</p></section>}
            {root && snapshot && <>
                {!snapshot.success && <section className='inu-memory-status'><h3>Memory map unavailable</h3><p>{snapshot.error ?? snapshot.message}</p>{snapshot.active && !snapshot.paused && <p>The debugger is active; press <strong>Pause</strong> in the Inu toolbar and read the map again.</p>}</section>}
                {snapshot.success && <>
                    <section><div className='inu-memory-facts'>
                        <div><span>Descriptors</span><strong>{snapshot.descriptorCount}</strong></div><div><span>Total described</span><strong>{this.formatBytes(snapshot.totalBytes)}</strong></div><div><span>Immediately usable</span><strong>{this.formatBytes(snapshot.usableBytes)}</strong></div><div><span>Highest address</span><strong>{snapshot.highestPhysicalAddress}</strong></div><div><span>Descriptor size</span><strong>{snapshot.descriptorSize} B</strong></div><div><span>UEFI version</span><strong>{snapshot.descriptorVersion}</strong></div><div><span>Map key</span><strong>{snapshot.mapKey}</strong></div><div><span>Capture attempts</span><strong>{snapshot.captureAttempts}</strong></div>
                    </div>{snapshot.message && <p className='inu-memory-note'>{snapshot.message}</p>}</section>
                    <section><h3>Memory composition</h3><div className='inu-memory-category-grid'>{snapshot.categories.map(item => <button key={item.category} className={`inu-memory-category cat-${item.category}`} onClick={() => { this.category = item.category; this.update(); }}><strong>{this.categoryLabel(item.category)}</strong><span>{this.formatBytes(item.byteCount)}</span><small>{item.regionCount} region{item.regionCount === 1 ? '' : 's'}</small></button>)}</div>{this.renderTrack(snapshot.regions)}<small className='inu-memory-track-note'>Track widths are proportional to descriptor byte counts; physical-address gaps are intentionally not compressed into fake memory.</small></section>
                    {snapshot.reservations.length > 0 && <section><h3>Inu boot reservations</h3><div className='inu-memory-reservations'>{snapshot.reservations.map(item => <div key={item.name}><strong>{item.name}</strong><code>{item.physicalStart}</code><span>{this.formatBytes(item.byteCount)}</span><small>{item.details}</small></div>)}</div></section>}
                    <section><div className='inu-memory-controls'><h3>Descriptors <span className='inu-count'>{regions.length}</span></h3><div><select value={this.category} onChange={event => { this.category = event.target.value as InuMemoryRegionCategory | 'all'; this.update(); }}>{categories.map(item => <option key={item} value={item}>{item === 'all' ? 'All categories' : this.categoryLabel(item)}</option>)}</select><input value={this.filter} placeholder='Filter type, address or attributes' onChange={event => { this.filter = event.target.value; this.update(); }} /></div></div>{this.renderTrack(regions)}
                        <div className='inu-memory-table-wrap'><table className='inu-memory-table'><thead><tr><th>#</th><th>Type</th><th>Physical start</th><th>Physical end</th><th>Pages</th><th>Size</th><th>Virtual</th><th>Attributes</th></tr></thead><tbody>{regions.map(region => <tr key={region.index}><td>{region.index}</td><td><span className={`inu-memory-dot cat-${region.category}`} /> <strong>{region.typeName}</strong><small>{this.categoryLabel(region.category)}</small></td><td><code>{region.physicalStart}</code></td><td><code>{region.physicalEnd}</code></td><td>{region.pageCount.toLocaleString()}</td><td>{this.formatBytes(region.byteCount)}</td><td><code>{region.virtualStart}</code></td><td><code>{region.attributes}</code></td></tr>)}</tbody></table></div>
                    </section>
                </>}
            </>}
        </div>;
    }
}
