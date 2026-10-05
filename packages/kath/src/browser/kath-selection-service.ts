import { injectable } from 'inversify';

@injectable()
export class KathSelectionService {
    protected selectedId: string | undefined;
    protected readonly listeners = new Set<(id: string | undefined) => void>();

    get selected(): string | undefined { return this.selectedId; }

    select(id: string | undefined): void {
        if (id === this.selectedId) { return; }
        this.selectedId = id;
        for (const listener of this.listeners) { listener(id); }
    }

    onDidChange(listener: (id: string | undefined) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }
}
