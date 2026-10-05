import { ContainerModule } from 'inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import {
    INU_PROJECT_SERVICE_PATH,
    InuProjectService
} from '../common/inu-protocol';
import { InuProjectServiceImpl } from './inu-project-service';

export default new ContainerModule(bind => {
    bind(InuProjectServiceImpl).toSelf().inSingletonScope();
    bind(InuProjectService).toService(InuProjectServiceImpl);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new JsonRpcConnectionHandler(INU_PROJECT_SERVICE_PATH, () =>
            ctx.container.get<InuProjectService>(InuProjectService)
        )
    ).inSingletonScope();
});
