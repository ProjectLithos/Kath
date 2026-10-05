import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuProjectConfiguration, InuProjectService } from '../common/inu-protocol';
import { buildKathArchitecture } from './kath-architecture-model';
import { KathSelectionService } from './kath-selection-service';

@injectable()
export class KathComponentLibraryWidget extends ReactWidget {
    static readonly ID = 'kath.component.library';
    static readonly LABEL = 'Components';
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    @inject(KathSelectionService) protected readonly selectionService!: KathSelectionService;
    protected configuration?: InuProjectConfiguration;
    protected query = '';

    @postConstruct()
    protected init(): void {
        this.id = KathComponentLibraryWidget.ID;
        this.title.label = KathComponentLibraryWidget.LABEL;
        this.title.caption = 'C# OS source components and interfaces';
        this.title.iconClass = 'codicon codicon-package';
        this.title.closable = true;
        this.addClass('kath-component-library-widget');
        this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => void this.refresh()));
        this.toDispose.push(this.selectionService.onDidChange(() => this.update()));
        void this.refresh();
    }

    async refresh(): Promise<void> {
        const projectPath = this.workspaceService.workspace?.resource.path.fsPath();
        if (!projectPath) { this.configuration = undefined; this.update(); return; }
        const result = await this.projectService.readProjectConfiguration(projectPath);
        this.configuration = result.success ? result.configuration : undefined;
        this.update();
    }

    protected render(): React.ReactNode {
        const components = this.configuration ? buildKathArchitecture(this.configuration) : [];
        const query = this.query.trim().toLowerCase();
        const filtered = components.filter(component => !query || [component.name, component.description, ...component.provides, ...component.requires].some(value => value.toLowerCase().includes(query)));
        return <div className='kath-component-library'>
            <div className='kath-component-search'><span className='codicon codicon-search'></span><input className='theia-input' placeholder='Search components or interfaces' value={this.query} onChange={event => { this.query = event.currentTarget.value; this.update(); }} /></div>
            <div className='kath-component-list'>
                {filtered.map(component => <button key={component.id} className={`kath-component-entry ${this.selectionService.selected === component.id ? 'selected' : ''}`} onClick={() => this.selectionService.select(component.id)}>
                    <strong>{component.name}</strong><span>{component.description}</span><small>{component.area} · {component.origin === 'Inu' ? 'Inu SDK · C# / NativeAOT' : 'OS-owned · C# / NativeAOT'}</small>
                </button>)}
                {!this.configuration && <p className='kath-side-empty'>Open an operating system to inspect its components.</p>}
            </div>
        </div>;
    }
}
