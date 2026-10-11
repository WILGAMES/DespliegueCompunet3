import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OrdersService } from './orders.service';

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Vence periódicamente las órdenes sin pagar cuyo plazo terminó.
 *
 * - ORDER_PAYMENT_DEADLINE_HOURS: horas para pagar. 0 (por defecto) = sin
 *   vencimiento y este proceso no arranca.
 * - ORDER_SWEEP_INTERVAL_MS: periodo en ms (por defecto 60000).
 * - En NODE_ENV=test no arranca; las pruebas llaman a
 *   OrdersService.expireOverdueOrders directamente.
 */
@Injectable()
export class OrdersScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersScheduler.name);

  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.configService.get<string>('NODE_ENV') === 'test') return;

    if (!this.ordersService.paymentDeadlineHours) return;

    const configured = Number(
      this.configService.get(
        'ORDER_SWEEP_INTERVAL_MS',
        DEFAULT_INTERVAL_MS,
      ),
    );

    const intervalMs =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_INTERVAL_MS;

    this.timer = setInterval(() => void this.sweep(), intervalMs);
    this.timer.unref();

    this.logger.log(
      `Vencimiento de órdenes: ${this.ordersService.paymentDeadlineHours} h para pagar, revisión cada ${intervalMs} ms`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.running) return;

    this.running = true;

    try {
      await this.ordersService.expireOverdueOrders();
    } catch (error) {
      this.logger.error(
        'Error en el ciclo de vencimiento de órdenes',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
