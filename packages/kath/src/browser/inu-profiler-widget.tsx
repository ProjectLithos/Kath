import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuProfilerSnapshot, InuProjectService } from '../common/inu-protocol';

@injectable()
export class InuProfilerWidget extends ReactWidget {
    static readonly ID = 'inu.performance.profiler';
    static readonly LABEL = 'Performance Profiler';
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    protected snapshot: InuProfilerSnapshot = { active:false, capturedAtUtc:'', elapsedMs:0, totalSamples:0, functions:[], cpus:[], counters:[] };
    protected polling?: ReturnType<typeof setInterval>;

    @postConstruct()
    protected init(): void {
        this.id=InuProfilerWidget.ID; this.title.label=InuProfilerWidget.LABEL; this.title.caption='Inu kernel performance profiler'; this.title.closable=true; this.addClass('inu-profiler-widget'); this.update();
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(()=>void this.refresh())); this.polling=setInterval(()=>void this.refresh(),1000); this.toDispose.push({dispose:()=>{if(this.polling)clearInterval(this.polling);}}); void this.refresh();
    }
    async refresh():Promise<void>{const root=this.workspaceService.workspace?.resource.path.fsPath();if(!root)return;this.snapshot=await this.projectService.readProfilerSnapshot(root);this.update();}
    protected async reset():Promise<void>{const root=this.workspaceService.workspace?.resource.path.fsPath();if(!root)return;this.snapshot=await this.projectService.resetProfiler(root);this.update();}
    protected bar(percent:number):React.ReactNode{return <div className='inu-profile-track'><span style={{width:`${Math.max(0,Math.min(100,percent))}%`}}></span></div>}
    protected render():React.ReactNode{const s=this.snapshot;const interrupt=s.counters.filter(c=>c.category==='interrupt').reduce((a,c)=>a+c.count,0);const syscalls=s.counters.filter(c=>c.category==='syscall').reduce((a,c)=>a+c.count,0);const switches=s.counters.filter(c=>c.name.includes('switch')||c.category==='scheduler').reduce((a,c)=>a+c.count,0);
        return <div className='inu-tool-page'><div className='inu-tool-header'><div><h2>Performance Profiler</h2><p>CPU sampling, boot timings, scheduler activity, interrupts, syscalls, heap and I/O counters.</p></div><div className='inu-tool-actions'><button className='theia-button' onClick={()=>void this.refresh()}>Refresh</button><button className='theia-button' onClick={()=>void this.reset()}>Reset</button></div></div>
            <div className='inu-dashboard-stats'><div className='inu-dashboard-stat'><span className='codicon codicon-dashboard'></span><div><small>Samples</small><strong>{s.totalSamples}</strong></div></div><div className='inu-dashboard-stat'><span className='codicon codicon-chip'></span><div><small>CPUs sampled</small><strong>{s.cpus.length}</strong></div></div><div className='inu-dashboard-stat'><span className='codicon codicon-zap'></span><div><small>Interrupts</small><strong>{interrupt}</strong></div></div><div className='inu-dashboard-stat'><span className='codicon codicon-symbol-method'></span><div><small>Syscalls</small><strong>{syscalls}</strong></div></div><div className='inu-dashboard-stat'><span className='codicon codicon-list-selection'></span><div><small>Context switches</small><strong>{switches}</strong></div></div><div className='inu-dashboard-stat'><span className='codicon codicon-rocket'></span><div><small>Observed boot</small><strong>{s.bootDurationMs!==undefined?`${s.bootDurationMs.toFixed(1)} ms`:'—'}</strong></div></div></div>
            <div className='inu-profiler-grid'><section className='inu-engineering-section'><h3>CPU utilisation</h3>{s.cpus.length?s.cpus.map(cpu=><div className='inu-profile-row' key={cpu.cpuIndex}><span>CPU {cpu.cpuIndex}</span>{this.bar(cpu.utilisationPercent)}<strong>{cpu.utilisationPercent.toFixed(1)}%</strong><small>{cpu.samples} samples</small></div>):<p className='inu-muted'>CPU utilisation appears when the running kernel emits profiler samples.</p>}</section>
            <section className='inu-engineering-section'><h3>Hot functions / boot stages</h3>{s.functions.length?<div className='inu-profile-functions'>{s.functions.slice(0,60).map((f,i)=><div className='inu-profile-function' key={`${f.name}-${i}`}><span>{f.name}<small>{f.category}</small></span>{this.bar(f.percent)}<strong>{f.percent.toFixed(1)}%</strong><span>{f.totalDurationMs.toFixed(3)} ms</span><small>{f.samples} sample{f.samples===1?'':'s'}</small></div>)}</div>:<p className='inu-muted'>{s.message}</p>}</section></div>
            <section className='inu-engineering-section'><h3>Kernel counters and latency</h3>{s.counters.length?<div className='inu-profiler-counters'>{s.counters.slice(0,100).map((c,i)=><div className='inu-profiler-counter' key={`${c.name}-${i}`}><strong>{c.name}</strong><span>{c.category}</span><span>{c.count.toLocaleString()} events</span><span>{c.averageDurationMs!==undefined?`${c.averageDurationMs.toFixed(3)} ms avg`:''}</span></div>)}</div>:<p className='inu-muted'>Runtime counters are accepted from <code>[INU:PROFILE] kind=counter category=interrupt name=irq14 delta=1</code>. Timed storage/network/heap events can include <code>duration_ms=…</code>.</p>}</section>
        </div>}
}
