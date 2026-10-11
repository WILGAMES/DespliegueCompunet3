import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuctionsService } from './auctions.service';

const DEFAULT_INTERVAL_MS = 5000;

/**
 * Ejecuta periódicamente la activación y el cierre de subastas.
 *
 * - AUCTION_SWEEP_INTERVAL_MS: periodo en ms (por defecto 5000).
 *   Con 0 queda desactivado.
 * - En NODE_ENV=test no arranca; las pruebas llaman a
 *   AuctionsService.activateDueAuctions / closeDueAuctions directamente.
 */
@Injectable()
export class AuctionsScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    AuctionsScheduler.name,
  );

  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly auctionsService: AuctionsService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    if (
      this.configService.get<string>('NODE_ENV') ===
      'test'
    ) {
      return;
    }

    const configured = Number(
      this.configService.get(
        'AUCTION_SWEEP_INTERVAL_MS',
        DEFAULT_INTERVAL_MS,
      ),
    );

    const intervalMs = Number.isFinite(configured)
      ? configured
      : DEFAULT_INTERVAL_MS;

    if (intervalMs <= 0) {
      this.logger.warn(
        'El cierre automático de subastas está desactivado.',
      );
      return;
    }

    this.timer = setInterval(
      () => void this.sweep(),
      intervalMs,
    );
    this.timer.unref();

    this.logger.log(
      `Cierre automático de subastas cada ${intervalMs} ms`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    // Evita solapar ejecuciones si una tarda más que el intervalo
    if (this.running) return;

    this.running = true;

    try {
      await this.auctionsService.activateDueAuctions();
      await this.auctionsService.closeDueAuctions();
    } catch (error) {
      this.logger.error(
        'Error en el ciclo de subastas',
        error instanceof Error
          ? error.stack
          : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
