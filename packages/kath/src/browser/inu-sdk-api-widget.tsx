import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { InuProjectService, InuSdkApiNamespaceModel } from '../common/inu-protocol';

@injectable()
export class InuSdkApiWidget extends ReactWidget {
    static readonly ID = 'inu.sdk.api';
    static readonly LABEL = 'SDK Help';

    @inject(InuProjectService)
    protected readonly projectService!: InuProjectService;

    protected siteUrl = '';
    protected error = '';
    protected apiModel: InuSdkApiNamespaceModel[] = [];

    @postConstruct()
    protected init(): void {
        this.id = InuSdkApiWidget.ID;
        this.title.label = InuSdkApiWidget.LABEL;
        this.title.caption = 'Inu SDK Help documentation';
        this.title.closable = true;
        this.addClass('inu-sdk-api-widget');
        void this.loadSite();
    }

    protected async loadSite(): Promise<void> {
        try {
            [this.siteUrl, this.apiModel] = await Promise.all([this.projectService.getSdkApiSiteUrl(), this.projectService.getSdkApiModel()]);
            this.error = '';
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.update();
    }

    protected render(): React.ReactNode {
        if (this.error) {
            return <div className='inu-tool-page'>
                <h2>Inu SDK Help</h2>
                <p>The bundled SDK Help site could not be loaded.</p>
                <pre>{this.error}</pre>
                <button className='theia-button' onClick={() => void this.loadSite()}>Retry</button>
            </div>;
        }
        if (!this.siteUrl) {
            return <div className='inu-tool-page'><h2>Inu SDK Help</h2><p>Loading bundled SDK Help…</p></div>;
        }
        const areas = ['Boot', 'Kernel', 'Userland'].map(area => `${area}: ${this.apiModel.filter(item => item.area === area).length} using(s)`).join(' · ');
        return <div className='inu-sdk-api-container'><div className='inu-sdk-api-model-summary'>Typed .NET SDK model · {areas}</div><iframe
            className='inu-sdk-api-frame'
            src={this.siteUrl}
            title='Inu SDK Help'
        /></div>;
    }
}
