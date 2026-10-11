import { Global, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

/**
 * Global: cualquier servicio puede inyectar RealtimeService sin importar
 * este módulo.
 */
@Global()
@Module({
  imports: [AuthModule, UsersModule],
  providers: [RealtimeService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
