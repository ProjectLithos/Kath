import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import { InuOperatingSystem, InuProjectConfiguration } from '../common/inu-protocol';

interface InuOperatingSystemRegistryEntry {
    id: string;
    name: string;
    location: string;
    hidden: boolean;
    instanceNumber: number;
}

interface InuOperatingSystemListState {
    schemaVersion: 4;
    defaultLocation: string;
    locations: string[];
    systems: InuOperatingSystemRegistryEntry[];
    nextInstanceByName: Record<string, number>;
}

interface LegacyOperatingSystemListState {
    schemaVersion?: number;
    defaultLocation?: string;
    locations?: string[];
    projectPaths?: string[];
    hiddenPaths?: string[];
    instanceNumbers?: Record<string, number>;
    nextInstanceByName?: Record<string, number>;
}

export interface InuAllocatedProjectDirectory {
    projectRoot: string;
    instanceNumber: number;
    osId: string;
}

/**
 * Persistent local registry for Kath&Inu operating systems.
 *
 * Each OS has a stable ID, display name and exact source location.  Delete/forget
 * operations resolve the target from this registry ID; they never infer a source
 * directory from the display name, list position, current workspace or folder scan.
 */
export class InuOsRegistry {
    protected readonly stateFile: string;

    constructor(protected readonly legacyLocations: readonly string[] = []) {
        const stateRoot = process.env.KATH_STATE_ROOT
            ? path.resolve(process.env.KATH_STATE_ROOT)
            : path.join(os.homedir(), '.kath');
        this.stateFile = path.join(stateRoot, 'operating-systems.json');
    }

    resolveLocation(location?: string): string {
        const requested = (location ?? '').trim();
        if (!requested) throw new Error('Choose a folder in which to save Kath&Inu operating systems.');
        return path.resolve(requested);
    }

    async getDefaultLocation(): Promise<string> {
        const state = await this.readState();
        if (state.defaultLocation) return state.defaultLocation;
        if (state.locations.length === 0) return '';
        state.defaultLocation = state.locations[state.locations.length - 1];
        await this.writeState(state);
        return state.defaultLocation;
    }

    async nextDefaultOperatingSystemName(baseName: string, location?: string): Promise<string> {
        const root = this.resolveLocation(location);
        await fs.mkdir(root, { recursive: true });
        const trimmedBase = baseName.trim() || 'MyOs';
        const escapedBase = trimmedBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const suffixPattern = new RegExp(`^${escapedBase}(\\d+)$`, 'i');
        const entries = await fs.readdir(root, { withFileTypes: true });
        let highest = 0;
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const names = [entry.name];
            try {
                const configurationText = await fs.readFile(path.join(root, entry.name, 'Inu.json'), 'utf8');
                const configuration = JSON.parse(configurationText) as Partial<InuProjectConfiguration>;
                if (typeof configuration.name === 'string' && configuration.name.trim()) names.push(configuration.name.trim());
            } catch { }
            for (const name of names) {
                if (name.localeCompare(trimmedBase, undefined, { sensitivity: 'accent' }) === 0) {
                    highest = Math.max(highest, 1);
                    continue;
                }
                const match = suffixPattern.exec(name);
                if (match) highest = Math.max(highest, Number.parseInt(match[1], 10) || 0);
            }
        }
        return `${trimmedBase}${Math.max(1, highest + 1)}`;
    }

    async listOperatingSystems(): Promise<InuOperatingSystem[]> {
        const state = await this.readState();
        await this.importLegacyDefaultLocation(state);
        let changed = false;

        // Discover projects in registered parent locations, but assign every discovered
        // OS a stable local ID before exposing it to the browser UI.
        for (const location of state.locations) {
            const entries = await fs.readdir(location, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const projectRoot = path.join(location, entry.name);
                if (this.findByLocation(state, projectRoot)) continue;
                const identity = await this.readProjectIdentity(projectRoot);
                if (!identity) continue;
                const instanceNumber = this.allocateInstanceNumber(state, identity.name);
                state.systems.push({ id: randomUUID(), name: identity.name, location: path.resolve(projectRoot), hidden: false, instanceNumber });
                changed = true;
            }
        }

        const systems: InuOperatingSystem[] = [];
        for (const entry of state.systems) {
            if (entry.hidden) continue;
            const identity = await this.readProjectIdentity(entry.location);
            if (!identity) continue;
            if (identity.name !== entry.name) { entry.name = identity.name; changed = true; }
            systems.push({
                id: entry.id,
                name: entry.name,
                location: entry.location,
                path: entry.location,
                uri: pathToFileURL(entry.location).toString(),
                instanceNumber: entry.instanceNumber
            });
        }

        if (changed) await this.writeState(state);
        return systems.sort((a, b) => a.name.localeCompare(b.name) || a.instanceNumber - b.instanceNumber || a.location.localeCompare(b.location));
    }

    async allocateProjectDirectory(name: string, location: string): Promise<InuAllocatedProjectDirectory> {
        const root = this.resolveLocation(location);
        await fs.mkdir(root, { recursive: true });
        const state = await this.readState();
        this.addLocation(state, root);
        state.defaultLocation = root;
        let instanceNumber = Math.max(1, state.nextInstanceByName[name] ?? 1);
        let folderName = instanceNumber === 1 ? name : `${name}-${instanceNumber}`;
        let projectRoot = path.join(root, folderName);
        while (true) {
            try {
                await fs.mkdir(projectRoot, { recursive: false });
                break;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                instanceNumber++;
                folderName = `${name}-${instanceNumber}`;
                projectRoot = path.join(root, folderName);
            }
        }
        const osId = randomUUID();
        state.nextInstanceByName[name] = instanceNumber + 1;
        state.systems.push({ id: osId, name, location: path.resolve(projectRoot), hidden: false, instanceNumber });
        await this.writeState(state);
        return { projectRoot, instanceNumber, osId };
    }

    async registerProject(projectRoot: string): Promise<void> {
        const resolved = path.resolve(projectRoot);
        const state = await this.readState();
        this.addLocation(state, path.dirname(resolved));
        const identity = await this.readProjectIdentity(resolved);
        const name = identity?.name || path.basename(resolved);
        const existing = this.findByLocation(state, resolved);
        if (existing) {
            existing.name = name;
            existing.hidden = false;
        } else {
            state.systems.push({ id: randomUUID(), name, location: resolved, hidden: false, instanceNumber: this.allocateInstanceNumber(state, name) });
        }
        await this.writeState(state);
    }

    async resolveProjectById(osId: string): Promise<InuOperatingSystem> {
        const requested = osId.trim();
        if (!requested) throw new Error('Operating-system ID is required.');
        const state = await this.readState();
        const entry = state.systems.find(candidate => candidate.id === requested);
        if (!entry) throw new Error(`Kath has no locally registered operating system with ID ${requested}.`);
        const identity = await this.readProjectIdentity(entry.location);
        if (!identity) throw new Error(`The registered operating-system source no longer exists at ${entry.location}.`);
        if (identity.name !== entry.name) {
            entry.name = identity.name;
            await this.writeState(state);
        }
        return {
            id: entry.id,
            name: entry.name,
            location: entry.location,
            path: entry.location,
            uri: pathToFileURL(entry.location).toString(),
            instanceNumber: entry.instanceNumber
        };
    }

    async hideProjectById(osId: string): Promise<void> {
        const state = await this.readState();
        const entry = state.systems.find(candidate => candidate.id === osId);
        if (!entry) throw new Error(`Kath has no locally registered operating system with ID ${osId}.`);
        entry.hidden = true;
        await this.writeState(state);
    }

    async forgetDeletedProjectById(osId: string): Promise<void> {
        const state = await this.readState();
        const before = state.systems.length;
        state.systems = state.systems.filter(candidate => candidate.id !== osId);
        if (state.systems.length === before) throw new Error(`Kath has no locally registered operating system with ID ${osId}.`);
        await this.writeState(state);
    }

    protected findByLocation(state: InuOperatingSystemListState, projectRoot: string): InuOperatingSystemRegistryEntry | undefined {
        const key = this.normalizedPath(projectRoot);
        return state.systems.find(candidate => this.normalizedPath(candidate.location) === key);
    }

    protected allocateInstanceNumber(state: InuOperatingSystemListState, name: string): number {
        const next = Math.max(1, state.nextInstanceByName[name] ?? 1);
        state.nextInstanceByName[name] = next + 1;
        return next;
    }

    protected normalizedPath(projectPath: string): string {
        return path.resolve(projectPath).toLowerCase();
    }

    protected async readProjectIdentity(projectRoot: string): Promise<{ name: string } | undefined> {
        try {
            const configurationText = await fs.readFile(path.join(projectRoot, 'Inu.json'), 'utf8');
            const configuration = JSON.parse(configurationText) as Partial<InuProjectConfiguration>;
            const name = typeof configuration.name === 'string' && configuration.name.trim() ? configuration.name.trim() : path.basename(projectRoot);
            return { name };
        } catch { return undefined; }
    }

    protected async readState(): Promise<InuOperatingSystemListState> {
        try {
            const parsed = JSON.parse(await fs.readFile(this.stateFile, 'utf8')) as Partial<InuOperatingSystemListState> & LegacyOperatingSystemListState;
            if (parsed.schemaVersion === 4 && Array.isArray(parsed.systems)) {
                return {
                    schemaVersion: 4,
                    defaultLocation: typeof parsed.defaultLocation === 'string' && parsed.defaultLocation.trim() ? path.resolve(parsed.defaultLocation) : '',
                    locations: Array.isArray(parsed.locations) ? parsed.locations.filter(value => typeof value === 'string').map(value => path.resolve(value)) : [],
                    systems: parsed.systems.filter((value): value is InuOperatingSystemRegistryEntry => !!value && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.location === 'string').map(value => ({ ...value, location: path.resolve(value.location), hidden: !!value.hidden, instanceNumber: Math.max(1, Number(value.instanceNumber) || 1) })),
                    nextInstanceByName: parsed.nextInstanceByName && typeof parsed.nextInstanceByName === 'object' ? parsed.nextInstanceByName as Record<string, number> : {}
                };
            }

            // One-time migration from the old path/index registry. Each migrated OS receives
            // a stable ID and retains its previous instance number and hidden state.
            const legacyPaths = Array.isArray(parsed.projectPaths) ? parsed.projectPaths.filter(value => typeof value === 'string').map(value => path.resolve(value)) : [];
            const hidden = Array.isArray(parsed.hiddenPaths) ? parsed.hiddenPaths.filter(value => typeof value === 'string').map(value => value.toLowerCase()) : [];
            const instanceNumbers = parsed.instanceNumbers && typeof parsed.instanceNumbers === 'object' ? parsed.instanceNumbers as Record<string, number> : {};
            const systems: InuOperatingSystemRegistryEntry[] = [];
            for (const projectRoot of legacyPaths) {
                const identity = await this.readProjectIdentity(projectRoot);
                if (!identity) continue;
                const key = this.normalizedPath(projectRoot);
                systems.push({ id: randomUUID(), name: identity.name, location: projectRoot, hidden: hidden.includes(key), instanceNumber: Math.max(1, instanceNumbers[key] ?? 1) });
            }
            const state: InuOperatingSystemListState = {
                schemaVersion: 4,
                defaultLocation: typeof parsed.defaultLocation === 'string' && parsed.defaultLocation.trim() ? path.resolve(parsed.defaultLocation) : '',
                locations: Array.isArray(parsed.locations) ? parsed.locations.filter(value => typeof value === 'string').map(value => path.resolve(value)) : [],
                systems,
                nextInstanceByName: parsed.nextInstanceByName && typeof parsed.nextInstanceByName === 'object' ? parsed.nextInstanceByName as Record<string, number> : {}
            };
            await this.writeState(state);
            return state;
        } catch {
            return { schemaVersion: 4, defaultLocation: '', locations: [], systems: [], nextInstanceByName: {} };
        }
    }

    protected async writeState(state: InuOperatingSystemListState): Promise<void> {
        await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
        await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
    }

    protected addLocation(state: InuOperatingSystemListState, location: string): void {
        const resolved = path.resolve(location);
        const key = this.normalizedPath(resolved);
        if (!state.locations.some(candidate => this.normalizedPath(candidate) === key)) state.locations.push(resolved);
    }

    protected async importLegacyDefaultLocation(state: InuOperatingSystemListState): Promise<void> {
        for (const candidate of this.legacyLocations) {
            if (!candidate || !candidate.trim()) continue;
            const root = path.resolve(candidate);
            try {
                const stat = await fs.stat(root);
                if (stat.isDirectory()) this.addLocation(state, root);
            } catch { }
        }
    }
}
