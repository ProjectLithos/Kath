import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuProjectConfiguration, InuProjectService } from '../common/inu-protocol';
import { buildKathArchitecture, KathArchitectureArea, KathArchitectureComponent } from './kath-architecture-model';
import { KathSelectionService } from './kath-selection-service';

@injectable()
export class KathArchitectureWidget extends ReactWidget {
    static readonly ID = 'kath.os.architecture';
    static readonly LABEL = 'OS Architecture';
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    @inject(KathSelectionService) protected readonly selectionService!: KathSelectionService;
    protected configuration?: InuProjectConfiguration;

    @postConstruct()
    protected init(): void {
        this.id = KathArchitectureWidget.ID;
        this.title.label = KathArchitectureWidget.LABEL;
        this.title.caption = 'Design the operating system as connected C# source components';
        this.title.iconClass = 'codicon codicon-type-hierarchy-sub';
        this.title.closable = true;
        this.addClass('kath-architecture-widget');
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
        if (!this.configuration) return <div className='kath-architecture-empty'><h2>OS Architecture</h2><p>Open a Kath/Inu operating system to display its architecture.</p></div>;
        const components = buildKathArchitecture(this.configuration);
        const areas: KathArchitectureArea[] = ['Boot', 'Kernel', 'Userland'];
        return <div className='kath-architecture-page'>
            <header className='kath-architecture-header'>
                <div><h1>{this.configuration.name}</h1><p>Architecture and source are two views of the same operating system.</p></div>
                <div className='kath-language-badge'>C# · NativeAOT</div>
            </header>
            <div className='kath-architecture-columns'>
                {areas.map(area => <section className='kath-architecture-area' key={area}>
                    <h2>{area}</h2>
                    <div className='kath-architecture-node-list'>
                        {components.filter(component => component.area === area).map(component => this.renderComponent(component, components))}
                        {!components.some(component => component.area === area) && <div className='kath-architecture-placeholder'>No component selected</div>}
                    </div>
                </section>)}
            </div>
        </div>;
    }

    protected renderComponent(component: KathArchitectureComponent, all: KathArchitectureComponent[]): React.ReactNode {
        const unresolved = component.requires.filter(required => !all.some(candidate => candidate.provides.includes(required)));
        const selected = this.selectionService.selected === component.id;
        return <button className={`kath-architecture-node ${selected ? 'selected' : ''}`} key={component.id} onClick={() => this.selectionService.select(component.id)}>
            <strong>{component.name}</strong>
            <small>{component.role} · {component.category} · {component.origin === 'Inu' ? 'Kath&Inu C# source' : 'OS-owned C# source'}</small>
            <span className='kath-implementation-status supported'>NativeAOT</span>
            {component.provides.length > 0 && <div><span>Provides</span><b>{component.provides.join(', ')}</b></div>}
            {component.requires.length > 0 && <div><span>Requires</span><b>{component.requires.join(', ')}</b></div>}
            {unresolved.length > 0 && <em>{unresolved.length} unresolved interface{unresolved.length === 1 ? '' : 's'}</em>}
        </button>;
    }
}
