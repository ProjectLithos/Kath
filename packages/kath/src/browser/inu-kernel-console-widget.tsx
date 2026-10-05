import * as React from 'react';
import { injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';

interface ConsoleLine { text: string; kind: 'info' | 'ok' | 'warn' | 'fail' | 'kernel'; }

@injectable()
export class InuKernelConsoleWidget extends ReactWidget {
    static readonly ID = 'inu.kernel.console';
    static readonly LABEL = 'Inu Console';
    protected lines: ConsoleLine[] = [];
    protected buffer = '';
    protected filter = '';
    protected paused = false;
    protected autoScroll = true;

    @postConstruct()
    protected init(): void {
        this.id = InuKernelConsoleWidget.ID;
        this.title.label = InuKernelConsoleWidget.LABEL;
        this.title.caption = 'Dedicated Inu build, serial and kernel console';
        this.title.closable = true;
        this.addClass('inu-kernel-console');
        this.update();
    }

    clear(): void { this.lines = []; this.buffer = ''; this.update(); }

    append(text: string): void {
        if (!text) { return; }
        this.buffer += text.replace(/\r/g, '');
        const parts = this.buffer.split('\n');
        this.buffer = parts.pop() ?? '';
        for (const raw of parts) {
            const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
            const kind: ConsoleLine['kind'] = /^\[FAIL\]/i.test(line) ? 'fail'
                : /^\[WARN\]/i.test(line) ? 'warn'
                : /^\[ OK \]/i.test(line) ? 'ok'
                : /^\[INFO\]|^\[DEBUG\]/i.test(line) ? 'info' : 'kernel';
            this.lines.push({ text: line, kind });
        }
        if (this.lines.length > 12000) this.lines.splice(0, this.lines.length - 12000);
        if (!this.paused) this.update();
    }

    protected render(): React.ReactNode {
        const needle = this.filter.trim().toLowerCase();
        const shown = needle ? this.lines.filter(line => line.text.toLowerCase().includes(needle)) : this.lines;
        return <div className='inu-console-root'>
            <div className='inu-console-toolbar'>
                <input className='theia-input' placeholder='Filter console…' value={this.filter} onChange={e => { this.filter = e.target.value; this.update(); }} />
                <button className='theia-button' onClick={() => { this.paused = !this.paused; this.update(); }}>{this.paused ? 'Resume' : 'Pause'}</button>
                <label><input type='checkbox' checked={this.autoScroll} onChange={e => { this.autoScroll = e.target.checked; this.update(); }} /> Auto-scroll</label>
                <button className='theia-button' onClick={() => this.clear()}>Clear</button>
            </div>
            <div className='inu-console-lines' ref={node => { if (node && this.autoScroll) requestAnimationFrame(() => node.scrollTop = node.scrollHeight); }}>
                {shown.map((line, index) => <div key={index} className={`inu-console-line ${line.kind}`}>{line.text || ' '}</div>)}
            </div>
        </div>;
    }
}
