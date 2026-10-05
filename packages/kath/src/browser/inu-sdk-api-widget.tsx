import * as React from 'react';
import { inject, injectable, postConstruct } from 'inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { InuProjectService } from '../common/inu-protocol';

@injectable()
export class InuSdkApiWidget extends ReactWidget {
    static readonly ID = 'inu.sdk.api';
    static readonly LABEL = 'SDK API';

    @inject(InuProjectService)
    protected readonly projectService!: InuProjectService;

    protected siteUrl = '';
    protected error = '';

    @postConstruct()
    protected init(): void {
        this.id = InuSdkApiWidget.ID;
        this.title.label = InuSdkApiWidget.LABEL;
        this.title.caption = 'Inu SDK API documentation';
        this.title.closable = true;
        this.addClass('inu-sdk-api-widget');
        void this.loadSite();
    }

    protected async loadSite(): Promise<void> {
        try {
            this.siteUrl = await this.projectService.getSdkApiSiteUrl();
            this.error = '';
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.update();
    }

    protected render(): React.ReactNode {
        if (this.error) {
            return <div className='inu-tool-page'>
                <h2>Inu SDK API</h2>
                <p>The bundled SDK API site could not be loaded.</p>
                <pre>{this.error}</pre>
                <button className='theia-button' onClick={() => void this.loadSite()}>Retry</button>
            </div>;
        }
        if (!this.siteUrl) {
            return <div className='inu-tool-page'><h2>Inu SDK API</h2><p>Loading bundled SDK documentation…</p></div>;
        }
        return <iframe
            className='inu-sdk-api-frame'
            src={this.siteUrl}
            title='Inu SDK API'
        />;
    }
}
