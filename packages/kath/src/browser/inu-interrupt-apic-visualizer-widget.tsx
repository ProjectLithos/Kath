import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuInterruptSnapshot, InuProjectService } from '../common/inu-protocol';

@injectable()
export class InuInterruptApicVisualizerWidget extends ReactWidget {
    static readonly ID='inu.interrupt.apic.visualizer'; static readonly LABEL='Inu Interrupt / APIC';
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    protected projectPath: string|undefined; protected snapshot:InuInterruptSnapshot|undefined; protected loading=false; protected vectorFilter='';
    @postConstruct() protected init():void { this.id=InuInterruptApicVisualizerWidget.ID; this.title.label=InuInterruptApicVisualizerWidget.LABEL; this.title.caption='Inspect Inu interrupt vectors, Local APIC, I/O APIC, MSI and MSI-X routing'; this.title.closable=true; this.addClass('inu-interrupt-apic-widget'); this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(()=>{this.projectPath=this.workspaceService.workspace?.resource.path.fsPath();this.snapshot=undefined;this.update();})); this.update(); }
    setProjectPath(value:string|undefined):void { const next=value?.trim()||undefined;if(next===this.projectPath)return;this.projectPath=next;this.snapshot=undefined;this.update(); }
    protected root():string|undefined{return this.workspaceService.workspace?.resource.path.fsPath()??this.projectPath;}
    async refresh():Promise<void>{const root=this.root();if(!root){this.snapshot=undefined;this.update();return;}this.loading=true;this.update();try{this.snapshot=await this.projectService.inspectInterrupts(root);}finally{this.loading=false;this.update();}}
    protected yes(value:boolean|undefined):string{return value===undefined?'—':value?'Yes':'No';}
    protected visibleVectors(){const needle=this.vectorFilter.trim().toLowerCase();return(this.snapshot?.vectors??[]).filter(v=>!needle||String(v.vector).includes(needle)||v.hex.includes(needle)||v.exceptionName?.toLowerCase().includes(needle)||v.callback?.toLowerCase().includes(needle));}
    protected render():React.ReactNode{const root=this.root(),s=this.snapshot,vectors=this.visibleVectors();return <div className='inu-tool-page inu-interrupt-page'>
        <div className='inu-tool-header'><div><h2>Interrupt / APIC Visualiser</h2><p>Inspect Inu's real interrupt-dispatch tables and opaque APIC/MSI broker from paused kernel memory.</p></div><button className='theia-button' disabled={!root||this.loading} onClick={()=>void this.refresh()}>{this.loading?'Reading…':'Read Interrupt State'}</button></div>
        {!root&&<p>Open a Inu operating system to inspect interrupts.</p>}
        {root&&!s&&<section><h3>Runtime interrupt state</h3><p>Run in <strong>Debug</strong>, continue until interrupt initialization has completed, pause the kernel, then select <strong>Read Interrupt State</strong>.</p></section>}
        {s&&!s.success&&<section><h3>Interrupt state unavailable</h3><p>{s.error??s.message}</p>{s.active&&!s.paused&&<p>Press <strong>Pause</strong> in the Inu toolbar and read the state again.</p>}</section>}
        {s?.success&&<>
          <section><div className='inu-interrupt-facts'><div><span>Dispatch</span><strong>{this.yes(s.dispatchInitialized)}</strong></div><div><span>Broker</span><strong>{this.yes(s.brokerInitialized)}</strong></div><div><span>Local APIC</span><strong>{this.yes(s.localApic)}</strong></div><div><span>I/O APIC</span><strong>{this.yes(s.ioApic)}</strong></div><div><span>x2APIC</span><strong>{this.yes(s.x2Apic)}</strong></div><div><span>MSI / MSI-X</span><strong>{this.yes(s.msi)} / {this.yes(s.msiX)}</strong></div><div><span>Active routes</span><strong>{s.routeCount}</strong></div><div><span>Dynamic vectors</span><strong>{s.allocatedDynamicVectors}</strong></div></div><p>{s.message}</p></section>
          <section><h3>Controller topology</h3><div className='inu-apic-topology'><div><strong>Local APIC</strong><code>{s.localApicBase??'—'}</code><small>{s.x2Apic?'x2APIC MSR mode':'xAPIC MMIO mode'}</small></div>{s.ioApics.map(a=><div key={a.index}><strong>I/O APIC {a.index}</strong><code>{a.mappedAddress}</code><small>GSI {a.baseGsi}–{a.maximumGsi} · {a.pinCount} pins</small></div>)}</div></section>
          {s.localApicRegisters.length>0&&<section><h3>Local APIC registers</h3><div className='inu-apic-registers'>{s.localApicRegisters.map(r=><div key={r.offset}><span>{r.name}</span><code>{r.offset}</code><strong>{r.value??'unavailable'}</strong></div>)}</div></section>}
          <section><h3>Interrupt routes <span className='inu-count'>{s.routes.length}</span></h3>{s.routes.length===0?<p>No broker routes are active.</p>:<div className='inu-interrupt-table-wrap'><table className='inu-interrupt-table'><thead><tr><th>Vector</th><th>Mechanism</th><th>Source</th><th>Target CPU</th><th>Device</th><th>PCI</th><th>Handle</th></tr></thead><tbody>{s.routes.map(r=><tr key={r.handle}><td><code>0x{r.vector.toString(16).padStart(2,'0')}</code></td><td><strong>{r.mechanism}</strong></td><td>{r.source}</td><td>{r.targetProcessor}</td><td>{r.direct?'kernel':r.device}</td><td><code>{r.pci??'—'}</code></td><td><code>{r.handle}</code></td></tr>)}</tbody></table></div>}</section>
          <section><div className='inu-memory-controls'><h3>Vector table <span className='inu-count'>{vectors.length}</span></h3><input value={this.vectorFilter} placeholder='Filter vector, exception or callback' onChange={e=>{this.vectorFilter=e.target.value;this.update();}}/></div><div className='inu-interrupt-table-wrap'><table className='inu-interrupt-table'><thead><tr><th>Vector</th><th>Kind</th><th>Name</th><th>Allocated</th><th>Callback</th><th>Cookie</th><th>Debugger break</th></tr></thead><tbody>{vectors.map(v=><tr key={v.vector}><td><code>{v.hex}</code> <small>{v.vector}</small></td><td>{v.kind}</td><td>{v.exceptionName??'—'}</td><td>{v.allocated?'yes':'no'}</td><td><code>{v.callback??'—'}</code></td><td><code>{v.cookie??'—'}</code></td><td>{v.breakOnException===undefined?'—':v.breakOnException?'armed':'off'}</td></tr>)}</tbody></table></div></section>
        </>}
    </div>;}
}
