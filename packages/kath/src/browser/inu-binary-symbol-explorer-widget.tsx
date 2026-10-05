import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuBinaryDescriptor, InuBinaryInspection, InuBinarySymbol, InuProjectService } from '../common/inu-protocol';

@injectable()
export class InuBinarySymbolExplorerWidget extends ReactWidget {
    static readonly ID = 'inu.binary.symbol.explorer';
    static readonly LABEL = 'Inu Binary / Symbols';

    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;

    protected projectPath: string | undefined;
    protected binaries: InuBinaryDescriptor[] = [];
    protected selectedPath: string | undefined;
    protected inspection: InuBinaryInspection | undefined;
    protected symbolFilter = '';
    protected loading = false;

    @postConstruct()
    protected init(): void {
        this.id = InuBinarySymbolExplorerWidget.ID;
        this.title.label = InuBinarySymbolExplorerWidget.LABEL;
        this.title.caption = 'Inspect Inu binaries, PE/COFF sections, PDBs and linked symbols';
        this.title.closable = true;
        this.addClass('inu-binary-symbol-explorer-widget');
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => {
            this.projectPath = this.workspaceService.workspace?.resource.path.fsPath();
            this.binaries = [];
            this.selectedPath = undefined;
            this.inspection = undefined;
            void this.refresh();
        }));
        this.update();
        void this.refresh();
    }

    setProjectPath(projectPath: string | undefined): void {
        const normalized = projectPath?.trim() || undefined;
        if (this.projectPath === normalized) return;
        this.projectPath = normalized;
        this.binaries = [];
        this.selectedPath = undefined;
        this.inspection = undefined;
        this.update();
        void this.refresh();
    }

    protected root(): string | undefined {
        return this.workspaceService.workspace?.resource.path.fsPath() ?? this.projectPath;
    }

    async refresh(): Promise<void> {
        const root = this.root();
        if (!root) { this.binaries = []; this.update(); return; }
        this.loading = true; this.update();
        try {
            this.binaries = await this.projectService.listBinaries(root);
            if (this.selectedPath && !this.binaries.some(item => item.path === this.selectedPath)) {
                this.selectedPath = undefined; this.inspection = undefined;
            }
            if (!this.selectedPath && this.binaries.length > 0) this.selectedPath = this.binaries[0].path;
            if (this.selectedPath) await this.inspectSelected();
        } finally { this.loading = false; this.update(); }
    }

    protected async select(binary: InuBinaryDescriptor): Promise<void> {
        this.selectedPath = binary.path;
        this.symbolFilter = '';
        this.inspection = undefined;
        this.update();
        await this.inspectSelected();
    }

    protected async inspectSelected(): Promise<void> {
        const root = this.root(); const selected = this.selectedPath;
        if (!root || !selected) return;
        this.loading = true; this.update();
        try { this.inspection = await this.projectService.inspectBinary(root, selected, this.symbolFilter); }
        finally { this.loading = false; this.update(); }
    }

    protected formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    }

    protected shortPath(value?: string): string {
        if (!value) return '';
        const root = this.root();
        return root && value.toLowerCase().startsWith(root.toLowerCase()) ? value.slice(root.length).replace(/^[/\\]+/, '') : value;
    }

    protected symbolRow(symbol: InuBinarySymbol, index: number): React.ReactNode {
        return <tr key={`${symbol.address ?? ''}:${symbol.name}:${index}`}>
            <td className='inu-binary-address'>{symbol.address ?? '—'}</td>
            <td><strong>{symbol.name}</strong>{symbol.sourcePath && <small>{this.shortPath(symbol.sourcePath)}{symbol.line ? `:${symbol.line}` : ''}</small>}</td>
            <td>{symbol.kind}</td>
            <td className='inu-binary-number'>{symbol.size === undefined ? '—' : this.formatBytes(symbol.size)}</td>
        </tr>;
    }

    protected render(): React.ReactNode {
        const root = this.root(); const selected = this.binaries.find(item => item.path === this.selectedPath);
        const detail = this.inspection;
        return <div className='inu-tool-page inu-binary-page'>
            <div className='inu-tool-header'><div><h2>Binary / Symbol Explorer</h2><p>Inspect linked Inu images, object files, PDBs, linker maps and source-symbol mappings without leaving the IDE.</p></div><button className='theia-button' disabled={!root || this.loading} onClick={() => void this.refresh()}>Refresh Artifacts</button></div>
            {!root && <p>Open a Inu operating system to inspect its binaries and symbols.</p>}
            {root && <div className='inu-binary-layout'>
                <aside className='inu-binary-list'><div className='inu-binary-list-title'>Artifacts <span className='inu-count'>{this.binaries.length}</span></div>
                    {this.binaries.length === 0 && !this.loading && <p>No binary or symbol artifacts were found. Build the OS first.</p>}
                    {this.binaries.map(item => <button key={item.id} className={`inu-binary-item ${item.path === this.selectedPath ? 'selected' : ''}`} onClick={() => void this.select(item)}>
                        <span><strong>{item.name}</strong><em>{item.kind}</em></span><small>{item.origin.toUpperCase()} · {this.formatBytes(item.sizeBytes)}</small><small title={item.path}>{this.shortPath(item.path)}</small>
                    </button>)}
                </aside>
                <main className='inu-binary-detail'>
                    {this.loading && !detail && <p>Reading binary metadata…</p>}
                    {selected && detail && <>
                        <section><div className='inu-binary-heading'><div><h3>{selected.name}</h3><code>{selected.path}</code></div><span className='inu-binary-kind'>{detail.format ?? selected.kind}</span></div>
                            {!detail.success && <div className='inu-binary-error'>{detail.error}</div>}
                            <div className='inu-binary-facts'>
                                <div><span>Architecture</span><strong>{detail.architecture ?? '—'}</strong></div><div><span>Image base</span><strong>{detail.imageBase ?? '—'}</strong></div><div><span>Entry point</span><strong>{detail.entryPoint ?? '—'}</strong></div><div><span>Size</span><strong>{this.formatBytes(selected.sizeBytes)}</strong></div>
                            </div>{detail.message && <p className='inu-binary-message'>{detail.message}</p>}
                        </section>
                        {detail.sections.length > 0 && <section><h3>Sections <span className='inu-count'>{detail.sections.length}</span></h3><div className='inu-binary-table-wrap'><table className='inu-binary-table'><thead><tr><th>Name</th><th>RVA</th><th>Virtual</th><th>Raw</th><th>Characteristics</th></tr></thead><tbody>{detail.sections.map(section => <tr key={`${section.name}:${section.virtualAddress}`}><td><strong>{section.name}</strong></td><td className='inu-binary-address'>{section.virtualAddress}</td><td>{this.formatBytes(section.virtualSize)}</td><td>{this.formatBytes(section.rawSize)}</td><td className='inu-binary-address'>{section.characteristics}</td></tr>)}</tbody></table></div></section>}
                        <section><div className='inu-binary-symbol-header'><h3>Symbols <span className='inu-count'>{detail.symbolCount}</span></h3><div><input value={this.symbolFilter} placeholder='Filter symbol or source path' onChange={event => { this.symbolFilter = event.target.value; this.update(); }} onKeyDown={event => { if (event.key === 'Enter') void this.inspectSelected(); }} /><button className='theia-button' disabled={this.loading} onClick={() => void this.inspectSelected()}>Search</button></div></div>
                            {detail.truncated && <p className='inu-binary-message'>Showing the first {detail.symbols.length} matching symbols. Narrow the filter to inspect more.</p>}
                            {detail.symbols.length === 0 ? <p>No symbols matched this artifact/filter.</p> : <div className='inu-binary-table-wrap'><table className='inu-binary-table'><thead><tr><th>Address</th><th>Symbol</th><th>Kind</th><th>Size</th></tr></thead><tbody>{detail.symbols.map((symbol,index) => this.symbolRow(symbol,index))}</tbody></table></div>}
                        </section>
                    </>}
                </main>
            </div>}
        </div>;
    }
}
