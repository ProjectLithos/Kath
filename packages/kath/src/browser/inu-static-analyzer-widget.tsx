import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuAnalyzerDiagnostic, InuAnalyzerSeverity, InuAnalyzerSnapshot, InuProjectService } from '../common/inu-protocol';

@injectable()
export class InuStaticAnalyzerWidget extends ReactWidget {
    static readonly ID = 'inu.static.analyzers';
    static readonly LABEL = 'Inu OS Analyzers';

    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;

    protected snapshot: InuAnalyzerSnapshot | undefined;
    protected loading = false;
    protected severity: 'all' | InuAnalyzerSeverity = 'all';
    protected projectPath: string | undefined;

    @postConstruct()
    protected init(): void {
        this.id = InuStaticAnalyzerWidget.ID;
        this.title.label = InuStaticAnalyzerWidget.LABEL;
        this.title.caption = 'Inu kernel, driver, architecture and userland static analyzers';
        this.title.closable = true;
        this.addClass('inu-static-analyzer-widget');
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => {
            this.projectPath = this.workspaceService.workspace?.resource.path.fsPath();
            this.snapshot = undefined;
            this.update();
        }));
        // ReactWidget does not render until an update is requested. Unlike the other
        // engineering widgets, the analyzer has no initial refresh call, so explicitly
        // request its first render when the widget is constructed.
        this.update();
    }

    setProjectPath(projectPath: string | undefined): void {
        const normalized = projectPath?.trim() || undefined;
        if (this.projectPath === normalized) { return; }
        this.projectPath = normalized;
        this.snapshot = undefined;
        this.update();
    }

    protected root(): string | undefined {
        return this.workspaceService.workspace?.resource.path.fsPath() ?? this.projectPath;
    }

    async analyze(): Promise<void> {
        const root = this.root(); if (!root) return;
        this.loading = true; this.update();
        try { this.snapshot = await this.projectService.analyzeOperatingSystem(root); }
        finally { this.loading = false; this.update(); }
    }

    protected visibleDiagnostics(): InuAnalyzerDiagnostic[] {
        if (!this.snapshot) return [];
        return this.severity === 'all' ? this.snapshot.diagnostics : this.snapshot.diagnostics.filter(item => item.severity === this.severity);
    }

    protected shortPath(filePath: string): string {
        const root = this.root();
        return root && filePath.toLowerCase().startsWith(root.toLowerCase()) ? filePath.slice(root.length).replace(/^[/\\]+/, '') : filePath;
    }

    protected render(): React.ReactNode {
        const diagnostics = this.visibleDiagnostics();
        return <div className='inu-tool-page'>
            <div className='inu-tool-header'><div><h2>OS-specific Static Analyzers</h2><p>Analyze Inu kernel, driver and userland source using OS architecture and capability rules rather than generic C# style checks.</p></div><div className='inu-tool-actions'><select value={this.severity} onChange={e => { this.severity = e.target.value as typeof this.severity; this.update(); }}><option value='all'>All severities</option><option value='error'>Errors</option><option value='warning'>Warnings</option><option value='info'>Information</option></select><button className='theia-button main' disabled={!this.root() || this.loading} onClick={() => void this.analyze()}>{this.loading ? 'Analyzing…' : 'Analyze OS'}</button></div></div>
            {!this.root() && <p>Open a Inu operating system to run the analyzers.</p>}
            {this.root() && !this.snapshot && !this.loading && <section className='inu-engineering-section'><h3>Analyzer scope</h3><p>Checks kernel/userland boundaries, architecture leakage, blocking/exception/async kernel patterns, interrupt-handler allocations, and driver capability declarations. Generated output, SDK sources, bin/obj and IDE metadata are excluded.</p></section>}
            {this.snapshot && <>
                <div className='inu-analyzer-summary'>
                    <div><strong>{this.snapshot.errorCount}</strong><span>Errors</span></div><div><strong>{this.snapshot.warningCount}</strong><span>Warnings</span></div><div><strong>{this.snapshot.infoCount}</strong><span>Info</span></div><div><strong>{this.snapshot.filesAnalyzed}</strong><span>C# files</span></div><div><strong>{this.snapshot.targetArchitecture ?? 'unknown'}</strong><span>Active target</span></div>
                </div>
                <section className='inu-engineering-section'><div className='inu-section-heading'><h3>Diagnostics <span className='inu-count'>{diagnostics.length}</span></h3><small className='inu-muted'>NOA rules are Inu OS contracts.</small></div>
                    {diagnostics.length === 0 ? <p className='inu-analyzer-clean'>No diagnostics at the selected severity.</p> : <div className='inu-analyzer-list'>{diagnostics.map((item, index) => <div className={`inu-analyzer-row ${item.severity}`} key={`${item.filePath}:${item.line}:${item.code}:${index}`}>
                        <span className='inu-analyzer-severity'>{item.severity.toUpperCase()}</span><strong>{item.code}</strong><span className='inu-analyzer-message'>{item.message}<small>{item.rule}</small></span><code>{this.shortPath(item.filePath)}:{item.line}:{item.column}</code>
                    </div>)}</div>}
                </section>
                <section className='inu-engineering-section'><h3>Rules currently enforced</h3><div className='inu-analyzer-rule-grid'><span>NOA1001/1002 · userland isolation</span><span>NOA2001–2003 · kernel execution safety</span><span>NOA3001–3003 · hardware/architecture boundaries</span><span>NOA4001 · interrupt allocation safety</span><span>NOA5001 · driver capability declarations</span></div></section>
            </>}
        </div>;
    }
}
