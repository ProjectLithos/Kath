import { inject, injectable, postConstruct } from 'inversify';
import { Emitter, Event, MessageService, URI } from '@theia/core/lib/common';
import { OutputChannelManager } from '@theia/output/lib/browser/output-channel';
import { BreakpointManager as TheiaBreakpointManager } from '@theia/debug/lib/browser/breakpoint/breakpoint-manager';
import { SourceBreakpoint } from '@theia/debug/lib/browser/breakpoint/breakpoint-marker';
import { InuBreakpointRequest, InuBreakpointResult, InuProjectService } from '../common/inu-protocol';

const OUTPUT_CHANNEL_NAME = 'Inu Build';
const BREAKPOINT_OPTIONS_STORAGE_KEY = 'inu.ide.breakpointOptions';

export interface InuSourceBreakpoint extends InuBreakpointRequest {
    verified: boolean;
    hitCount?: number;
}

/**
 * Bridges Theia's authoritative source-breakpoint UI to the Inu/QEMU
 * debugger backend. Theia owns gutter dots, F9, persistence and breakpoint
 * editor behaviour; Inu owns native-address resolution and GDB arming.
 */
@injectable()
export class InuBreakpointManager {
    @inject(InuProjectService)
    protected readonly projectService!: InuProjectService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(OutputChannelManager)
    protected readonly outputChannelManager!: OutputChannelManager;

    @inject(TheiaBreakpointManager)
    protected readonly theiaBreakpoints!: TheiaBreakpointManager;

    protected readonly verification = new Map<string, boolean>();
    protected readonly hitCounts = new Map<string, number>();
    protected readonly options = new Map<string, { condition?: string; hitCondition?: string }>();
    protected readonly changeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changeEmitter.event;
    protected sessionId: string | undefined;
    protected contextLocation: { sourcePath: string; line: number } | undefined;
    protected suppressNativeMirror = false;

    @postConstruct()
    protected init(): void {
        this.loadOptions();
        this.theiaBreakpoints.onDidChangeBreakpoints(event => {
            this.changeEmitter.fire(undefined);
            if (!this.sessionId || this.suppressNativeMirror) {
                return;
            }
            // The native editor UI can add/remove breakpoints directly (gutter/F9).
            // Mirror those changes into the live Inu debugger session.
            for (const breakpoint of event.added) {
                void this.armRuntimeBreakpoint(breakpoint.uri.path.fsPath(), breakpoint.line);
            }
            for (const breakpoint of event.removed) {
                const sourcePath = breakpoint.uri.path.fsPath();
                const key = this.key(sourcePath, breakpoint.line);
                this.options.delete(key);
                this.verification.delete(key);
                this.hitCounts.delete(key);
                this.saveOptions();
                void this.armRuntimeBreakpoint(sourcePath, breakpoint.line);
            }
        });
    }

    setSession(sessionId: string | undefined): void {
        this.sessionId = sessionId;
        if (!sessionId) {
            this.verification.clear();
            this.hitCounts.clear();
            this.changeEmitter.fire(undefined);
        }
    }

    getSession(): string | undefined {
        return this.sessionId;
    }

    setContextLocation(sourcePath: string, line: number): void {
        if (line > 0) {
            this.contextLocation = { sourcePath, line };
        }
    }

    consumeContextLocation(): { sourcePath: string; line: number } | undefined {
        const location = this.contextLocation;
        this.contextLocation = undefined;
        return location;
    }

    all(): InuSourceBreakpoint[] {
        return this.theiaBreakpoints.getBreakpoints().map(breakpoint => {
            const sourcePath = breakpoint.uri.path.fsPath();
            const key = this.key(sourcePath, breakpoint.line);
            const option = this.options.get(key);
            return {
                sourcePath,
                line: breakpoint.line,
                condition: option?.condition,
                hitCondition: option?.hitCondition,
                hitCount: this.hitCounts.get(key),
                verified: this.verification.get(key) ?? false
            };
        });
    }

    has(sourcePath: string, line: number): boolean {
        const uri = new URI(sourcePath);
        return this.theiaBreakpoints.getLineBreakpoints(uri, line).length > 0;
    }

    forSource(sourcePath: string): InuSourceBreakpoint[] {
        const normalized = this.normalize(sourcePath);
        return this.all().filter(item => this.normalize(item.sourcePath) === normalized);
    }

    async toggle(sourcePath: string, line: number): Promise<InuBreakpointResult> {
        const uri = new URI(sourcePath);
        const existing = this.theiaBreakpoints.getLineBreakpoints(uri, line);

        if (existing.length) {
            this.suppressNativeMirror = true;
            try {
                for (const breakpoint of existing) {
                    this.theiaBreakpoints.removeBreakpoint(breakpoint);
                }
            } finally {
                this.suppressNativeMirror = false;
            }
            const removedKey = this.key(sourcePath, line);
            this.verification.delete(removedKey);
            this.hitCounts.delete(removedKey);
            this.options.delete(removedKey);
            this.saveOptions();
            if (!this.sessionId) {
                return { success: true, verified: false, sourcePath, line, message: 'Breakpoint removed.' };
            }
            return this.armRuntimeBreakpoint(sourcePath, line);
        }

        this.suppressNativeMirror = true;
        try {
            this.theiaBreakpoints.addBreakpoint(SourceBreakpoint.create(uri, { line }));
        } finally {
            this.suppressNativeMirror = false;
        }
        if (!this.sessionId) {
            return { success: true, verified: false, sourcePath, line, message: 'Breakpoint set. It will be armed when Debug starts.' };
        }
        return this.armRuntimeBreakpoint(sourcePath, line);
    }

    applyRuntimeBreakpoints(results: InuBreakpointResult[] | undefined): void {
        if (!results) {
            return;
        }
        for (const result of results) {
            const key = this.key(result.sourcePath, result.line);
            this.verification.set(key, result.verified);
            if (typeof result.hitCount === 'number') { this.hitCounts.set(key, result.hitCount); }
        }
        this.changeEmitter.fire(undefined);
    }

    async armAll(sessionId: string): Promise<void> {
        this.setSession(sessionId);
        this.suppressNativeMirror = true;
        try {
            for (const breakpoint of this.theiaBreakpoints.getBreakpoints()) {
                await this.armRuntimeBreakpoint(breakpoint.uri.path.fsPath(), breakpoint.line);
            }
        } finally {
            this.suppressNativeMirror = false;
        }
        this.changeEmitter.fire(undefined);
    }

    protected async armRuntimeBreakpoint(sourcePath: string, line: number): Promise<InuBreakpointResult> {
        if (!this.sessionId) {
            return { success: true, verified: false, sourcePath, line, message: 'Breakpoint stored.' };
        }
        const option = this.options.get(this.key(sourcePath, line));
        const result = await this.projectService.toggleBreakpoint(this.sessionId, sourcePath, line, option?.condition, option?.hitCondition);
        const resultKey = this.key(sourcePath, line);
        this.verification.set(resultKey, result.verified);
        if (typeof result.hitCount === 'number') { this.hitCounts.set(resultKey, result.hitCount); }
        this.log(result);
        this.changeEmitter.fire(undefined);
        return result;
    }


    getOptions(sourcePath: string, line: number): { condition?: string; hitCondition?: string } {
        return { ...(this.options.get(this.key(sourcePath, line)) ?? {}) };
    }

    async setCondition(sourcePath: string, line: number, condition: string | undefined): Promise<InuBreakpointResult | undefined> {
        return this.updateOptions(sourcePath, line, { condition: this.clean(condition) });
    }

    async setHitCondition(sourcePath: string, line: number, hitCondition: string | undefined): Promise<InuBreakpointResult | undefined> {
        return this.updateOptions(sourcePath, line, { hitCondition: this.clean(hitCondition) });
    }

    protected async updateOptions(sourcePath: string, line: number, patch: { condition?: string; hitCondition?: string }): Promise<InuBreakpointResult | undefined> {
        if (!this.has(sourcePath, line)) {
            await this.toggle(sourcePath, line);
        }
        const key = this.key(sourcePath, line);
        const current = this.options.get(key) ?? {};
        const next = { ...current, ...patch };
        if (!next.condition && !next.hitCondition) { this.options.delete(key); }
        else { this.options.set(key, next); }
        this.saveOptions();
        this.changeEmitter.fire(undefined);
        if (!this.sessionId) { return undefined; }
        const result = await this.projectService.updateBreakpoint(this.sessionId, {
            sourcePath,
            line,
            condition: next.condition,
            hitCondition: next.hitCondition
        });
        this.verification.set(key, result.verified);
        if (typeof result.hitCount === 'number') { this.hitCounts.set(key, result.hitCount); }
        this.log(result);
        this.changeEmitter.fire(undefined);
        return result;
    }

    protected clean(value: string | undefined): string | undefined {
        const trimmed = value?.trim();
        return trimmed ? trimmed : undefined;
    }

    protected loadOptions(): void {
        try {
            const raw = window.localStorage.getItem(BREAKPOINT_OPTIONS_STORAGE_KEY);
            if (!raw) { return; }
            const parsed = JSON.parse(raw) as Record<string, { condition?: string; hitCondition?: string }>;
            for (const [key, value] of Object.entries(parsed)) {
                if (!value || typeof value !== 'object') { continue; }
                const condition = this.clean(value.condition);
                const hitCondition = this.clean(value.hitCondition);
                if (condition || hitCondition) { this.options.set(key, { condition, hitCondition }); }
            }
        } catch { }
    }

    protected saveOptions(): void {
        try {
            window.localStorage.setItem(BREAKPOINT_OPTIONS_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.options.entries())));
        } catch { }
    }

    protected log(result: InuBreakpointResult): void {
        const channel = this.outputChannelManager.getChannel(OUTPUT_CHANNEL_NAME);
        channel.appendLine(`[DEBUG] ${result.sourcePath}:${result.line}: ${result.message ?? (result.verified ? 'Breakpoint verified.' : 'Breakpoint pending.')}`);
    }

    protected key(sourcePath: string, line: number): string {
        return `${this.normalize(sourcePath)}:${line}`;
    }

    protected normalize(sourcePath: string): string {
        return sourcePath.replace(/\\/g, '/').toLowerCase();
    }
}
