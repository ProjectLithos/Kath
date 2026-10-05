import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import {
    InuDiskEntry,
    InuDiskImageDescriptor,
    InuDiskImageInspection,
    InuDiskReadResult,
    InuProjectService
} from '../common/inu-protocol';

@injectable()
export class InuImageDiskExplorerWidget extends ReactWidget {
    static readonly ID = 'inu.image.disk.explorer';
    static readonly LABEL = 'Inu Image / Disk Explorer';

    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;

    protected images: InuDiskImageDescriptor[] = [];
    protected selectedPath: string | undefined;
    protected inspection: InuDiskImageInspection | undefined;
    protected selectedEntry: InuDiskEntry | undefined;
    protected readResult: InuDiskReadResult | undefined;
    protected loading = false;
    protected diskOffset = '0x0';
    protected entryOffset = '0x0';
    protected readLength = '512';
    protected filter = '';

    @postConstruct()
    protected init(): void {
        this.id = InuImageDiskExplorerWidget.ID;
        this.title.label = InuImageDiskExplorerWidget.LABEL;
        this.title.caption = 'Inspect Inu disk images, GPT/MBR partitions, FAT32 volumes and files';
        this.title.closable = true;
        this.addClass('inu-image-disk-widget');
    }

    protected projectPath(): string | undefined {
        return this.workspaceService.workspace?.resource.path.fsPath();
    }

    async refresh(): Promise<void> {
        const projectPath = this.projectPath();
        if (!projectPath) { this.images = []; this.inspection = undefined; this.update(); return; }
        this.loading = true; this.update();
        try {
            this.images = await this.projectService.listDiskImages(projectPath);
            if (this.selectedPath && !this.images.some(i => i.path === this.selectedPath)) this.selectedPath = undefined;
            if (!this.selectedPath && this.images.length) this.selectedPath = this.images[0].path;
            if (this.selectedPath) await this.inspect(this.selectedPath, false);
        } finally { this.loading = false; this.update(); }
    }

    protected async inspect(imagePath: string, updateLoading = true): Promise<void> {
        const projectPath = this.projectPath(); if (!projectPath) return;
        if (updateLoading) { this.loading = true; this.update(); }
        try {
            this.selectedPath = imagePath; this.selectedEntry = undefined; this.readResult = undefined;
            this.inspection = await this.projectService.inspectDiskImage(projectPath, imagePath);
        } finally { if (updateLoading) { this.loading = false; this.update(); } }
    }

    protected parseNumber(value: string): number {
        const text = value.trim().toLowerCase();
        const n = text.startsWith('0x') ? Number.parseInt(text.slice(2), 16) : Number.parseInt(text, 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    }

    protected async readDisk(): Promise<void> {
        const projectPath = this.projectPath(); if (!projectPath || !this.selectedPath) return;
        this.readResult = await this.projectService.readDiskImage(projectPath, this.selectedPath, this.parseNumber(this.diskOffset), this.parseNumber(this.readLength));
        this.selectedEntry = undefined; this.update();
    }

    protected async readEntry(entry: InuDiskEntry): Promise<void> {
        this.selectedEntry = entry; this.entryOffset = '0x0'; this.update();
        if (entry.directory) return;
        const projectPath = this.projectPath(); if (!projectPath || !this.selectedPath) return;
        this.readResult = await this.projectService.readDiskImageEntry(projectPath, this.selectedPath, entry.path, 0, this.parseNumber(this.readLength));
        this.update();
    }

    protected async readSelectedEntry(): Promise<void> {
        const projectPath = this.projectPath(); if (!projectPath || !this.selectedPath || !this.selectedEntry || this.selectedEntry.directory) return;
        this.readResult = await this.projectService.readDiskImageEntry(projectPath, this.selectedPath, this.selectedEntry.path, this.parseNumber(this.entryOffset), this.parseNumber(this.readLength));
        this.update();
    }

    protected formatBytes(value: number | undefined): string {
        if (value === undefined) return '—';
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
        if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
        return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
    }

    protected shortPath(value: string): string {
        const projectPath = this.projectPath();
        if (projectPath && value.toLowerCase().startsWith(projectPath.toLowerCase())) return value.slice(projectPath.length).replace(/^[/\\]+/, '');
        return value;
    }

    protected hexRows(read: InuDiskReadResult): React.ReactNode[] {
        const rows: React.ReactNode[] = [];
        for (let i = 0; i < read.bytes.length; i += 16) {
            const slice = read.bytes.slice(i, i + 16);
            const address = (read.offset + i).toString(16).padStart(8, '0');
            const hex = slice.map(v => v.toString(16).padStart(2, '0')).join(' ');
            const ascii = slice.map(v => v >= 32 && v <= 126 ? String.fromCharCode(v) : '.').join('');
            rows.push(<tr key={i}><td>0x{address}</td><td>{hex}</td><td>{ascii}</td></tr>);
        }
        return rows;
    }

    protected visibleEntries(): InuDiskEntry[] {
        const all = this.inspection?.entries ?? [];
        const needle = this.filter.trim().toLowerCase();
        return needle ? all.filter(e => e.path.toLowerCase().includes(needle)) : all;
    }

    protected entryDepth(entry: InuDiskEntry): number {
        return Math.max(0, entry.path.split('/').filter(Boolean).length - 1);
    }

    protected render(): React.ReactNode {
        const inspection = this.inspection;
        const selected = this.images.find(i => i.path === this.selectedPath);
        const entries = this.visibleEntries();
        return <div className='inu-image-disk-page'>
            <header className='inu-engineering-header'>
                <div><h2>Image / Disk Explorer</h2><p>Inspect Inu boot images without mounting them on the host. Tiny debugger/telemetry .bin files are ignored automatically.</p></div>
                <button className='theia-button' disabled={this.loading} onClick={() => void this.refresh()}>{this.loading ? 'Reading…' : 'Refresh Images'}</button>
            </header>
            {!this.projectPath() && <p>Open a Inu OS project to inspect its disk images.</p>}
            {this.projectPath() && !this.loading && this.images.length === 0 && <p>No disk images were found in the OS project or bundled SDK artifacts. Supported discovery includes .img, .raw, .iso, .vhd, .vhdx and disk-like .bin files.</p>}
            {this.images.length > 0 && <div className='inu-disk-layout'>
                <aside className='inu-disk-images'>
                    <h3>Images <span className='inu-count'>{this.images.length}</span></h3>
                    {this.images.map(image => <button key={image.id} className={`inu-disk-image ${image.path === this.selectedPath ? 'selected' : ''}`} onClick={() => void this.inspect(image.path)}>
                        <strong>{image.name}</strong><small>{image.formatHint} · {this.formatBytes(image.sizeBytes)}</small><small>{image.origin.toUpperCase()} · {this.shortPath(image.path)}</small>
                    </button>)}
                </aside>
                <main className='inu-disk-detail'>
                    {selected && inspection && <>
                        <section>
                            <div className='inu-disk-title'><div><h3>{selected.name}</h3><code>{selected.path}</code></div><span>{inspection.scheme.toUpperCase()}</span></div>
                            {!inspection.success && <div className='inu-binary-error'>{inspection.error}</div>}
                            <div className='inu-disk-facts'>
                                <div><span>Image size</span><strong>{this.formatBytes(selected.sizeBytes)}</strong></div>
                                <div><span>Sector size</span><strong>{inspection.sectorSize} B</strong></div>
                                <div><span>Partitions</span><strong>{inspection.partitions.length}</strong></div>
                                <div><span>Filesystem entries</span><strong>{inspection.entryCount}{inspection.truncated ? '+' : ''}</strong></div>
                                <div><span>Protective MBR</span><strong>{inspection.protectiveMbr ? 'Yes' : 'No'}</strong></div>
                                <div><span>Disk GUID</span><strong>{inspection.diskGuid ?? '—'}</strong></div>
                            </div>
                            {inspection.message && <p className='inu-binary-message'>{inspection.message}</p>}
                        </section>
                        <section><h3>Partitions</h3>
                            {inspection.partitions.length === 0 ? <p>No MBR/GPT partition table was detected.</p> : <div className='inu-disk-table-wrap'><table className='inu-disk-table'><thead><tr><th>#</th><th>Name / Type</th><th>Start LBA</th><th>End LBA</th><th>Offset</th><th>Size</th><th>Boot</th></tr></thead><tbody>{inspection.partitions.map(p => <tr key={`${p.scheme}:${p.index}`}><td>{p.index}</td><td><strong>{p.name}</strong><small>{p.type}</small></td><td><code>{p.firstLba}</code></td><td><code>{p.lastLba}</code></td><td>{this.formatBytes(p.offsetBytes)}</td><td>{this.formatBytes(p.sizeBytes)}</td><td>{p.bootable ? 'Yes' : '—'}</td></tr>)}</tbody></table></div>}
                        </section>
                        <section><h3>Volumes</h3>
                            {inspection.volumes.length === 0 ? <p>No supported FAT32 volume was detected.</p> : <div className='inu-disk-volume-grid'>{inspection.volumes.map(v => <div key={v.partitionIndex}><strong>{v.label || v.fileSystem}</strong><span>{v.fileSystem} · Partition {v.partitionIndex}</span><small>{v.bytesPerSector} B/sector · {v.sectorsPerCluster} sector(s)/cluster · {v.fatCount} FAT(s)</small><small>Root cluster {v.rootCluster} · {v.freeClusters !== undefined ? `${v.freeClusters} free clusters` : 'free space unavailable'}</small></div>)}</div>}
                        </section>
                        <section>
                            <div className='inu-disk-section-head'><h3>Filesystem</h3><input value={this.filter} placeholder='Filter path' onChange={e => { this.filter = e.target.value; this.update(); }} /></div>
                            {entries.length === 0 ? <p>No filesystem entries matched.</p> : <div className='inu-disk-tree'>{entries.map(entry => <button key={`${entry.partitionIndex}:${entry.path}`} className={this.selectedEntry?.path === entry.path ? 'selected' : ''} style={{ paddingLeft: `${10 + this.entryDepth(entry) * 18}px` }} onClick={() => void this.readEntry(entry)}><span>{entry.directory ? '▸' : '·'} <strong>{entry.name}</strong></span><small>{entry.directory ? 'directory' : this.formatBytes(entry.sizeBytes)} · cluster {entry.firstCluster}</small></button>)}</div>}
                        </section>
                        <section>
                            <div className='inu-disk-section-head'><h3>{this.selectedEntry && !this.selectedEntry.directory ? `File bytes — ${this.selectedEntry.path}` : 'Raw image bytes'}</h3></div>
                            <div className='inu-disk-read-controls'>
                                <label>{this.selectedEntry && !this.selectedEntry.directory ? 'File offset' : 'Disk offset'}<input value={this.selectedEntry && !this.selectedEntry.directory ? this.entryOffset : this.diskOffset} onChange={e => { if (this.selectedEntry && !this.selectedEntry.directory) this.entryOffset = e.target.value; else this.diskOffset = e.target.value; this.update(); }} /></label>
                                <label>Bytes<input value={this.readLength} onChange={e => { this.readLength = e.target.value; this.update(); }} /></label>
                                <button className='theia-button' onClick={() => void (this.selectedEntry && !this.selectedEntry.directory ? this.readSelectedEntry() : this.readDisk())}>Read</button>
                                {this.selectedEntry && <button className='theia-button secondary' onClick={() => { this.selectedEntry = undefined; this.readResult = undefined; this.update(); }}>Raw disk</button>}
                            </div>
                            {this.readResult?.error && <div className='inu-binary-error'>{this.readResult.error}</div>}
                            {this.readResult?.success && <><p className='inu-binary-message'>Showing {this.readResult.length} byte(s) at offset 0x{this.readResult.offset.toString(16)} of {this.formatBytes(this.readResult.totalLength)}.</p><div className='inu-disk-hex-wrap'><table className='inu-disk-hex'><thead><tr><th>Offset</th><th>Hex</th><th>ASCII</th></tr></thead><tbody>{this.hexRows(this.readResult)}</tbody></table></div></>}
                        </section>
                    </>}
                </main>
            </div>}
        </div>;
    }
}
