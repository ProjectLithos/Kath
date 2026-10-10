import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { EditorManager } from '@theia/editor/lib/browser';

export type InuProblemSeverity = 'error' | 'warning';

export interface InuProblem {
    severity: InuProblemSeverity;
    filePath?: string;
    line?: number;
    column?: number;
    code?: string;
    message: string;
}

@injectable()
export class InuProblemsWidget extends ReactWidget {
    static readonly ID = 'inu.problems';
    static readonly LABEL = 'Problems';

    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    protected problems: InuProblem[] = [];
    protected readonly liveProblems = new Map<string, InuProblem[]>();
    protected pending = '';
    protected readonly keys = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.id = InuProblemsWidget.ID;
        this.title.label = InuProblemsWidget.LABEL;
        this.title.caption = 'Inu compiler, SDK and build diagnostics';
        this.title.closable = true;
        this.addClass('inu-problems-widget');
        this.update();
    }

    clear(): void {
        // Build/output diagnostics are transient. Live editor diagnostics belong to the
        // open source models and therefore remain visible until the source is corrected
        // or the model is closed.
        this.problems = [];
        this.pending = '';
        this.keys.clear();
        this.updateTitle();
        this.update();
    }

    setLiveProblems(filePath: string, problems: InuProblem[]): void {
        const key = filePath.trim().toLowerCase();
        if (!key) return;
        if (problems.length === 0) this.liveProblems.delete(key);
        else this.liveProblems.set(key, problems.map(problem => ({ ...problem, filePath: problem.filePath || filePath })));
        this.updateTitle();
        this.update();
    }

    clearLiveProblems(filePath: string): void {
        const key = filePath.trim().toLowerCase();
        if (!key || !this.liveProblems.delete(key)) return;
        this.updateTitle();
        this.update();
    }

    protected get allProblems(): InuProblem[] {
        const combined = [...this.problems, ...Array.from(this.liveProblems.values()).flat()];
        const seen = new Set<string>();
        return combined.filter(problem => {
            const key = `${problem.severity}|${(problem.filePath ?? '').toLowerCase()}|${problem.line ?? 0}|${problem.column ?? 0}|${problem.code ?? ''}|${problem.message}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    appendOutput(text: string, complete = false): void {
        if (!text && !complete) return;
        const combined = this.pending + (text ?? '');
        const lines = combined.split(/\r?\n/);
        this.pending = complete ? '' : (lines.pop() ?? '');
        for (const line of lines) this.parseLine(line);
        if (complete && this.pending) {
            this.parseLine(this.pending);
            this.pending = '';
        }
        this.updateTitle();
        this.update();
    }

    get count(): number { return this.allProblems.length; }
    get errorCount(): number { return this.allProblems.filter(problem => problem.severity === 'error').length; }
    get warningCount(): number { return this.allProblems.filter(problem => problem.severity === 'warning').length; }

    addBuildFailure(message: string, code = 'NOVA-RUN'): void {
        this.addBuildProblem('error', message, code);
        this.updateTitle();
        this.update();
    }

    protected updateTitle(): void {
        const count = this.allProblems.length;
        this.title.label = count ? `Problems (${count})` : InuProblemsWidget.LABEL;
    }

    protected parseLine(raw: string): void {
        const line = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').trim();
        if (!line) return;

        // Roslyn/MSBuild: C:\path\File.cs(12,34): error CS1234: message [project.csproj]
        let match = /^(.*)\((\d+)(?:,(\d+))?\):\s*(error|warning)\s*([A-Za-z]+\d+)?\s*:\s*(.*)$/i.exec(line);
        if (match) {
            this.addProblem(match[4].toLowerCase() as InuProblemSeverity, match[1], Number(match[2]), Number(match[3] ?? 1), match[5], this.trimProjectSuffix(match[6]));
            return;
        }

        // Clang/LLVM/NASM-style: C:\path\file.asm:12:4: error: message
        match = /^(.*?):(\d+)(?::(\d+))?:\s*(error|warning)(?:\s+([A-Za-z]+\d+))?\s*:\s*(.*)$/i.exec(line);
        if (match) {
            this.addProblem(match[4].toLowerCase() as InuProblemSeverity, match[1], Number(match[2]), Number(match[3] ?? 1), match[5], match[6]);
            return;
        }

        // Inu SDK/project refresh failures do not always originate at a source line.
        // Where the SDK names conflicting project files, make those concrete files navigable.
        match = /^\[FAIL\]\s+More than one root kernel project exists in (.*?):\s*(.+)$/i.exec(line);
        if (match) {
            const root = match[1].trim().replace(/[\\/]+$/, '');
            const projects = match[2].split(',').map(value => value.trim()).filter(value => /\.csproj$/i.test(value));
            if (projects.length) {
                for (const project of projects) this.addProblem('error', `${root}\\${project}`, 1, 1, 'NOVA-PROJECT', line.replace(/^\[FAIL\]\s*/i, ''));
            } else {
                this.addBuildProblem('error', line.replace(/^\[FAIL\]\s*/i, ''), 'NOVA-SDK');
            }
            return;
        }

        // PowerShell location lines are navigable even when the preceding SDK failure was not.
        match = /^At\s+([A-Za-z]:\\.*?):(\d+)\s+char:(\d+)$/i.exec(line);
        if (match) {
            this.addProblem('error', match[1], Number(match[2]), Number(match[3]), 'POWERSHELL', 'SDK command failed at this script location.');
            return;
        }

        // Inu SDK/build failures and explicit warnings still belong in Problems even when
        // there is no source location. They remain visible but are intentionally non-navigable.
        match = /^\[(FAIL|WARN)\]\s*(.*)$/i.exec(line);
        if (match) {
            this.addBuildProblem(match[1].toUpperCase() === 'FAIL' ? 'error' : 'warning', match[2], 'NOVA-SDK');
            return;
        }

        if (/^(Selected Inu project refresh failed|Managed compilation failed|Inu build\/run command exited)/i.test(line)) {
            this.addBuildProblem('error', line, 'NOVA-SDK');
        }
    }

    protected trimProjectSuffix(message: string): string {
        return message.replace(/\s+\[[^\]]+\]\s*$/, '').trim();
    }

    protected addProblem(severity: InuProblemSeverity, filePath: string, line: number, column: number, code: string | undefined, message: string): void {
        const normalizedPath = filePath.trim();
        if (!normalizedPath || !Number.isFinite(line) || line < 1) return;
        const problem: InuProblem = {
            severity,
            filePath: normalizedPath,
            line,
            column: Number.isFinite(column) && column > 0 ? column : 1,
            code: code?.trim() || undefined,
            message: message.trim()
        };
        this.pushProblem(problem);
    }

    protected addBuildProblem(severity: InuProblemSeverity, message: string, code?: string): void {
        const clean = message.trim();
        if (!clean) return;
        this.pushProblem({ severity, code: code?.trim() || undefined, message: clean });
    }

    protected pushProblem(problem: InuProblem): void {
        const key = `${problem.severity}|${(problem.filePath ?? '').toLowerCase()}|${problem.line ?? 0}|${problem.column ?? 0}|${problem.code ?? ''}|${problem.message}`;
        if (this.keys.has(key)) return;
        this.keys.add(key);
        this.problems.push(problem);
    }

    protected async openProblem(problem: InuProblem): Promise<void> {
        if (!problem.filePath || !problem.line) return;
        try {
            const editor = await this.editorManager.open(FileUri.create(problem.filePath));
            const position = { line: Math.max(0, problem.line - 1), character: Math.max(0, (problem.column ?? 1) - 1) };
            editor.editor.cursor = position;
            editor.editor.revealPosition(position);
        } catch {
            // Keep the Problems list usable even if a stale diagnostic points to a removed file.
        }
    }

    protected shortFile(filePath?: string): string {
        if (!filePath) return 'Build';
        const normalized = filePath.replace(/\\/g, '/');
        return normalized.slice(normalized.lastIndexOf('/') + 1) || filePath;
    }

    protected render(): React.ReactNode {
        return <div className='inu-problems-page'>
            <div className='inu-problems-summary' aria-label='Problem summary'>
                <span className='error'>{this.errorCount} Error{this.errorCount === 1 ? '' : 's'}</span>
                <span className='warning'>{this.warningCount} Warning{this.warningCount === 1 ? '' : 's'}</span>
            </div>
            <div className='inu-problems-grid' role='table' aria-label='Inu build problems'>
                <div className='inu-problems-header' role='row'>
                    <span role='columnheader'>Severity</span>
                    <span role='columnheader'>File</span>
                    <span role='columnheader'>Line</span>
                    <span role='columnheader'>Message</span>
                </div>
                {this.allProblems.length === 0
                    ? <div className='inu-problems-empty'>No errors or warnings.</div>
                    : this.allProblems.map((problem, index) => <div
                        className={`inu-problem-row ${problem.severity} ${problem.filePath && problem.line ? 'navigable' : 'summary'}`}
                        role='row'
                        tabIndex={problem.filePath && problem.line ? 0 : -1}
                        title={problem.filePath && problem.line ? `${problem.filePath}:${problem.line}:${problem.column ?? 1}` : problem.message}
                        key={`${problem.filePath ?? 'build'}:${problem.line ?? 0}:${problem.column ?? 0}:${problem.code ?? ''}:${index}`}
                        onClick={() => { if (problem.filePath && problem.line) void this.openProblem(problem); }}
                        onKeyDown={event => { if (problem.filePath && problem.line && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void this.openProblem(problem); } }}>
                        <span className='inu-problem-severity' role='cell'><span className={`codicon ${problem.severity === 'error' ? 'codicon-error' : 'codicon-warning'}`} aria-hidden='true' />{problem.severity === 'error' ? 'Error' : 'Warning'}</span>
                        <span className='inu-problem-file' role='cell'>{this.shortFile(problem.filePath)}</span>
                        <span className='inu-problem-line' role='cell'>{problem.line ?? '—'}</span>
                        <span className='inu-problem-message' role='cell'>{problem.code && <code>{problem.code}</code>}{problem.message}</span>
                    </div>)}
            </div>
        </div>;
    }
}
