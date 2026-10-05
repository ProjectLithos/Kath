import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuProjectConfiguration, InuProjectService } from '../common/inu-protocol';

@injectable()
export class InuDashboardWidget extends ReactWidget {
    static readonly ID='inu.os.dashboard'; static readonly LABEL='Kath&Inu Dashboard';
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    protected configuration?: InuProjectConfiguration;
    @postConstruct() protected init():void{this.id=InuDashboardWidget.ID;this.title.label=InuDashboardWidget.LABEL;this.title.caption='Kath&Inu operating-system architecture';this.title.closable=true;this.addClass('inu-dashboard-widget');this.update();this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(()=>void this.refresh()));void this.refresh();}
    async refresh():Promise<void>{const p=this.workspaceService.workspace?.resource.path.fsPath();if(!p){this.configuration=undefined;this.update();return;}const c=await this.projectService.readProjectConfiguration(p);this.configuration=c.success?c.configuration:undefined;this.update();}
    protected stat(label:string,value:string,icon:string):React.ReactNode{return <div className='inu-dashboard-stat'><span className={`codicon codicon-${icon}`}></span><div><small>{label}</small><strong>{value}</strong></div></div>}
    protected render():React.ReactNode{const c=this.configuration;if(!c)return <div className='inu-tool-page'><h2>Kath&Inu Dashboard</h2><p>Open a Kath&Inu operating system to display its architecture.</p></div>;
        const list=(items:string[],empty='None'):string=>items.length?items.join(' · '):empty;
        return <div className='inu-tool-page'><div className='inu-dashboard-title'><div><h1>{c.name}</h1><p>Kath&Inu architecture · {c.location}</p></div><button className='theia-button' onClick={()=>void this.refresh()}>Refresh</button></div>
            <div className='inu-dashboard-stats'>{this.stat('Architecture','x64','server-process')}{this.stat('Boot','UEFI','debug-start')}{this.stat('Kernel',c.kernelArchitecture,'symbol-structure')}{this.stat('Startup',c.startupModel,'terminal')}{this.stat('Executable formats',String(c.executableFormats.length),'file-binary')}{this.stat('Hardware support',String(c.hardwareSupport.length),'circuit-board')}</div>
            <div className='inu-dashboard-grid'>
                <section><h3>Identity</h3><dl><dt>OS</dt><dd>{c.name}</dd><dt>Author</dt><dd>{c.author}</dd><dt>Logo</dt><dd>{c.logoPath || 'None'}</dd><dt>Schema</dt><dd>{String(c.schemaVersion)}</dd></dl></section>
                <section><h3>Platform</h3><dl><dt>Architecture</dt><dd>x64</dd><dt>Boot</dt><dd>UEFI</dd><dt>Kernel language</dt><dd>C# / NativeAOT</dd><dt>Hardware discovery</dt><dd>Runtime discovery enabled</dd></dl></section>
                <section><h3>Execution model</h3><dl><dt>Kernel</dt><dd>{c.kernelArchitecture}</dd><dt>Startup</dt><dd>{c.startupModel}</dd><dt>Executables</dt><dd>{list(c.executableFormats)}</dd><dt>Applications</dt><dd>Ring 3</dd></dl></section>
                <section><h3>Hardware support</h3><dl><dt>Selected</dt><dd>{list(c.hardwareSupport,'No optional hardware support selected')}</dd></dl></section>
                {c.kernelArchitecture==='custom' && <section><h3>Custom placement</h3><dl><dt>Selected mechanisms</dt><dd>{Object.entries(c.customExecutionPlacements ?? {}).map(([key,value])=>`${key} → ${value}`).join(', ') || 'No custom placements recorded yet'}</dd></dl></section>}
                <section><h3>Source ownership</h3><dl><dt>Execution partitions</dt><dd>Boot · Kernel · Userland</dd><dt>Provided source</dt><dd>Provided/</dd><dt>Coder-owned source</dt><dd>{c.name}/</dd></dl></section>
            </div>
        </div>}
}
