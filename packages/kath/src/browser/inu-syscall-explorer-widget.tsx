import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuProjectService, InuSyscallAbi, InuSyscallSnapshot } from '../common/inu-protocol';

@injectable()
export class InuSyscallExplorerWidget extends ReactWidget {
    static readonly ID='inu.syscall.explorer'; static readonly LABEL='Inu Syscall Explorer';
    @inject(WorkspaceService) protected readonly workspaceService!:WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!:InuProjectService;
    protected projectPath:string|undefined; protected snapshot:InuSyscallSnapshot|undefined; protected loading=false; protected filter=''; protected abi:'all'|InuSyscallAbi='all';
    @postConstruct() protected init():void{this.id=InuSyscallExplorerWidget.ID;this.title.label=InuSyscallExplorerWidget.LABEL;this.title.caption='Inspect Inu Get/Set/Event, Linux and Windows/NT syscall contracts and live registrations';this.title.closable=true;this.addClass('inu-syscall-explorer-widget');this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(()=>{this.projectPath=this.workspaceService.workspace?.resource.path.fsPath();this.snapshot=undefined;this.update();}));this.update();}
    setProjectPath(value:string|undefined):void{const next=value?.trim()||undefined;if(next===this.projectPath)return;this.projectPath=next;this.snapshot=undefined;this.update();}
    protected root():string|undefined{return this.workspaceService.workspace?.resource.path.fsPath()??this.projectPath;}
    async refresh():Promise<void>{const root=this.root();if(!root)return;this.loading=true;this.update();try{this.snapshot=await this.projectService.inspectSyscalls(root);}finally{this.loading=false;this.update();}}
    protected entries(){const n=this.filter.trim().toLowerCase();return(this.snapshot?.entries??[]).filter(e=>(this.abi==='all'||e.abi===this.abi)&&(!n||e.name.toLowerCase().includes(n)||e.abi.includes(n)||String(e.number).includes(n)||e.encoded?.toLowerCase().includes(n)||e.handlerAddress?.toLowerCase().includes(n)||e.sourcePath?.toLowerCase().includes(n)));}
    protected fact(label:string,value:React.ReactNode){return <div><span>{label}</span><strong>{value??'—'}</strong></div>;}
    protected render():React.ReactNode{const root=this.root(),s=this.snapshot,entries=this.entries();const abis:InuSyscallAbi[]=['inu-get','inu-set','inu-event','linux','windows-nt'];return <div className='inu-tool-page inu-syscall-page'>
      <div className='inu-tool-header'><div><h2>Syscall Explorer</h2><p>Explore the shared protected syscall core across Inu Get/Set/Event, Linux-style and Windows/NT-style namespaces.</p></div><button className='theia-button' disabled={!root||this.loading} onClick={()=>void this.refresh()}>{this.loading?'Reading…':'Read Syscalls'}</button></div>
      {!root&&<p>Open a Inu operating system to inspect its syscall contract.</p>}
      {root&&!s&&<section><h3>System-call contract</h3><p>Select <strong>Read Syscalls</strong> to load the configured ABI. For live registrations, run in Debug and pause after system-call initialization.</p></section>}
      {s&&<><section><div className='inu-syscall-facts'>{this.fact('Configured model',s.configuredModel)}{this.fact('Kernel initialized',s.initialized===undefined?'not paused':s.initialized?'Yes':'No')}{this.fact('SMAP',s.smapEnabled===undefined?'—':s.smapEnabled?'Enabled':'Disabled')}{this.fact('Processors configured',s.configuredProcessors)}{this.fact('Registry slots / ABI',s.registrySlots)}{this.fact('Syscall stack',s.syscallStackBytes!==undefined?`${s.syscallStackBytes.toLocaleString()} bytes`:'—')}</div><p>{s.error??s.message}</p>{s.active&&!s.paused&&<p>Pause the kernel to include the live handler registry.</p>}</section>
      {s.syscallStackBase&&<section><h3>Protected entry stack</h3><div className='inu-syscall-addresses'><code>{s.syscallStackBase}</code><span>→</span><code>{s.syscallStackTop}</code></div></section>}
      <section><h3>Live registrations</h3><div className='inu-syscall-counts'>{abis.map(a=><div key={a}><span>{a}</span><strong>{s.registeredCounts[a]}</strong></div>)}</div></section>
      <section><div className='inu-memory-controls'><h3>Services <span className='inu-count'>{entries.length}</span></h3><select value={this.abi} onChange={e=>{this.abi=e.target.value as 'all'|InuSyscallAbi;this.update();}}><option value='all'>All ABIs</option>{abis.map(a=><option key={a} value={a}>{a}</option>)}</select><input value={this.filter} placeholder='Filter service, number, address or source' onChange={e=>{this.filter=e.target.value;this.update();}}/></div>
      <div className='inu-interrupt-table-wrap'><table className='inu-interrupt-table'><thead><tr><th>ABI</th><th>Number</th><th>Encoded</th><th>Service</th><th>Source</th><th>Handler</th><th>Source location</th></tr></thead><tbody>{entries.map((e,i)=><tr key={`${e.abi}:${e.number}:${e.source}:${i}`}><td><strong>{e.abi}</strong></td><td>{e.number}</td><td><code>{e.encoded??'—'}</code></td><td>{e.name}{e.description&&<small className='inu-syscall-description'>{e.description}</small>}</td><td>{e.source}</td><td><code>{e.handlerAddress??(e.source==='builtin'?'kernel built-in':'—')}</code></td><td>{e.sourcePath?<><code>{e.sourcePath}</code>{e.line&&<span>:{e.line}</span>}</>:'—'}</td></tr>)}</tbody></table></div></section></>}
    </div>;}
}
