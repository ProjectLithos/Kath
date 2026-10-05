import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { InuProjectConfiguration, InuProjectService } from '../common/inu-protocol';
import { buildKathArchitecture } from './kath-architecture-model';
import { KathSelectionService } from './kath-selection-service';

@injectable()
export class KathComponentInspectorWidget extends ReactWidget {
    static readonly ID = 'kath.component.inspector';
    static readonly LABEL = 'Component Inspector';
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;
    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    @inject(KathSelectionService) protected readonly selectionService!: KathSelectionService;
    protected configuration?: InuProjectConfiguration;

    @postConstruct()
    protected init(): void {
        this.id = KathComponentInspectorWidget.ID;
        this.title.label = KathComponentInspectorWidget.LABEL;
        this.title.caption = 'Selected C# component, interfaces and source ownership';
        this.title.iconClass = 'codicon codicon-inspect';
        this.title.closable = true;
        this.addClass('kath-component-inspector-widget');
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
        const selected = this.selectionService.selected;
        const component = this.configuration && selected ? buildKathArchitecture(this.configuration).find(item => item.id === selected) : undefined;
        if (!component) return <div className='kath-inspector-empty'>Select a component in the architecture or component library.</div>;
        const section = (title: string, values: string[]): React.ReactNode => values.length ? <section><h3>{title}</h3><div className='kath-interface-chips'>{values.map(value => <span key={value}>{value}</span>)}</div></section> : undefined;
        return <div className='kath-component-inspector'>
            <h2>{component.name}</h2>
            <p>{component.description}</p>
            <dl><dt>Area</dt><dd>{component.area}</dd><dt>Source role</dt><dd>{component.role}</dd><dt>Category</dt><dd>{component.category}</dd><dt>Origin</dt><dd>{component.origin}</dd><dt>Source language</dt><dd>{component.sdkLanguage}</dd><dt>Compiler</dt><dd>NativeAOT</dd>{component.sourceHint && <><dt>Source area</dt><dd>{component.sourceHint}</dd></>}</dl>
            {section('Provides', component.provides)}
            {section('Requires', component.requires)}
            <div className='kath-source-authority-note'><strong>Source ownership</strong><br/>Once an Inu component is copied into an OS project, that copy is the OS author's source. Kath must not silently regenerate over user changes.</div>
        </div>;
    }
}
