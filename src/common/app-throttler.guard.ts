import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Limita solo peticiones HTTP; los mensajes de Socket.IO no se cuentan. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return Promise.resolve(true);

    return super.canActivate(context);
  }
}
