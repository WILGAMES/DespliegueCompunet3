import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  Repository,
} from 'typeorm';

import { Order } from './entities/order.entity';
import {
  DeliveryAction,
  OrderStatus,
  PaymentResult,
} from './enums/order-status.enum';
import { PayOrderDto } from './dto/pay-order.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';

import { Auction } from '../auctions/entities/auction.entity';
import { AuctionStatus } from '../auctions/enums/auction-status.enum';
import { RealtimeService } from '../realtime/realtime.service';
import { Role } from '../users/enums/role.enum';

export interface OrderActor {
  id: number;
  role: Role;
}

type Party = 'buyer' | 'seller' | 'admin';

/**
 * Quién puede llevar la orden a cada estado de entrega, y desde qué estados.
 * - DELIVERED: el vendedor entrega (solo con pago aprobado).
 * - CANCELLED: anulación antes del pago, o del vendedor tras el pago
 *   (reembolso simulado).
 * - DEFAULTED: el vendedor reporta que el comprador no pagó, o el comprador
 *   reporta que el vendedor no entregó.
 * El administrador puede ejecutar cualquier transición válida.
 */
const DELIVERY_RULES: Record<
  DeliveryAction,
  { from: OrderStatus; by: Party[] }[]
> = {
  [DeliveryAction.DELIVERED]: [
    { from: OrderStatus.PAID, by: ['seller', 'admin'] },
  ],
  [DeliveryAction.CANCELLED]: [
    {
      from: OrderStatus.PENDING_PAYMENT,
      by: ['buyer', 'seller', 'admin'],
    },
    {
      from: OrderStatus.PAYMENT_REJECTED,
      by: ['buyer', 'seller', 'admin'],
    },
    { from: OrderStatus.PAID, by: ['seller', 'admin'] },
  ],
  [DeliveryAction.DEFAULTED]: [
    {
      from: OrderStatus.PENDING_PAYMENT,
      by: ['seller', 'admin'],
    },
    {
      from: OrderStatus.PAYMENT_REJECTED,
      by: ['seller', 'admin'],
    },
    { from: OrderStatus.PAID, by: ['buyer', 'admin'] },
  ],
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(
    OrdersService.name,
  );

  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    private readonly dataSource: DataSource,

    private readonly realtime: RealtimeService,

    private readonly configService: ConfigService,
  ) {}

  /**
   * Horas disponibles para pagar desde que se crea la orden.
   * ORDER_PAYMENT_DEADLINE_HOURS=0 (por defecto) desactiva el vencimiento.
   */
  get paymentDeadlineHours(): number {
    const hours = Number(
      this.configService.get(
        'ORDER_PAYMENT_DEADLINE_HOURS',
        0,
      ),
    );

    return Number.isFinite(hours) && hours > 0 ? hours : 0;
  }

  /**
   * Crea la orden de pago simulada de una subasta finalizada.
   *
   * Es idempotente: si ya existe una orden para la subasta la devuelve
   * (`created: false`) sin duplicar. Usa INSERT ... ON CONFLICT DO NOTHING
   * sobre la restricción única `auctionId`, así no aborta la transacción
   * del llamador aunque el cierre se ejecute dos veces en paralelo.
   *
   * El proceso de cierre de subastas debe llamarlo dentro de su propia
   * transacción, pasando su `manager`; en ese caso el evento en tiempo real
   * lo publica el llamador una vez confirmada la transacción.
   */
  async createForAuction(
    auctionId: number,
    manager?: EntityManager,
  ): Promise<{ order: Order; created: boolean }> {
    const em = manager ?? this.dataSource.manager;

    const auction = await em.findOne(Auction, {
      where: { id: auctionId },
    });

    if (!auction) {
      throw new NotFoundException(
        'Subasta no encontrada',
      );
    }

    if (auction.status !== AuctionStatus.FINISHED) {
      throw new BadRequestException(
        'Solo se puede crear una orden para una subasta finalizada',
      );
    }

    if (!auction.winnerId) {
      throw new BadRequestException(
        'La subasta finalizada no tiene ganador',
      );
    }

    const deadlineHours = this.paymentDeadlineHours;

    const result = await em
      .createQueryBuilder()
      .insert()
      .into(Order)
      .values({
        auctionId: auction.id,
        buyerId: auction.winnerId,
        sellerId: auction.sellerId,
        amount: Number(auction.currentPrice),
        status: OrderStatus.PENDING_PAYMENT,
        paymentDueAt: deadlineHours
          ? new Date(Date.now() + deadlineHours * 3600_000)
          : null,
      })
      .orIgnore()
      .returning(['id'])
      .execute();

    // Con ON CONFLICT DO NOTHING, RETURNING no devuelve filas si ya existía
    const created = result.raw.length > 0;

    const order = await em.findOneOrFail(Order, {
      where: { auctionId: auction.id },
    });

    if (created) {
      this.logger.log(
        `Orden ${order.id} creada para subasta ${auction.id} (comprador ${order.buyerId})`,
      );

      if (!manager) this.realtime.publishOrder('created', order);
    }

    return { order, created };
  }

  async findAll(
    actor: OrderActor,
    status?: OrderStatus,
  ): Promise<Order[]> {
    const qb = this.ordersRepository
      .createQueryBuilder('o')
      .orderBy('o.id', 'DESC');

    if (actor.role !== Role.ADMIN) {
      qb.where(
        '(o.buyerId = :userId OR o.sellerId = :userId)',
        { userId: actor.id },
      );
    }

    if (status) {
      qb.andWhere('o.status = :status', { status });
    }

    return qb.getMany();
  }

  async findOne(
    id: number,
    actor: OrderActor,
  ): Promise<Order> {
    const order = await this.ordersRepository.findOne({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException(
        'Orden no encontrada',
      );
    }

    this.assertParticipant(order, actor);

    return order;
  }

  /**
   * Pago simulado. Solo el comprador de la orden. Se permite reintentar
   * tras un pago rechazado; una orden pagada o cerrada no admite más pagos.
   */
  async pay(
    id: number,
    dto: PayOrderDto,
    actor: OrderActor,
  ): Promise<Order> {
    const paid = await this.dataSource.transaction(
      async (manager) => {
        const order = await this.lockOrder(manager, id);

        if (order.buyerId !== actor.id) {
          throw new ForbiddenException(
            'Solo el ganador puede registrar el pago de la orden',
          );
        }

        if (
          order.status !== OrderStatus.PENDING_PAYMENT &&
          order.status !== OrderStatus.PAYMENT_REJECTED
        ) {
          throw new ConflictException(
            `No se puede pagar una orden en estado ${order.status}`,
          );
        }

        if (
          order.paymentDueAt &&
          order.paymentDueAt.getTime() <= Date.now()
        ) {
          throw new ConflictException(
            'El plazo para pagar esta orden venció',
          );
        }

        order.paymentAttempts += 1;

        if (dto.result === PaymentResult.APPROVED) {
          order.status = OrderStatus.PAID;
          order.paidAt = new Date();
          order.paymentReference = `SIM-${randomUUID()}`;
        } else {
          order.status = OrderStatus.PAYMENT_REJECTED;
        }

        const saved = await manager.save(order);

        this.logger.log(
          `Orden ${saved.id}: pago simulado ${dto.result} por usuario ${actor.id} -> ${saved.status}`,
        );

        return saved;
      },
    );

    this.realtime.publishOrder('updated', paid);

    return paid;
  }

  /** Registro de entrega, cancelación o incumplimiento. */
  async updateDelivery(
    id: number,
    dto: UpdateDeliveryDto,
    actor: OrderActor,
  ): Promise<Order> {
    const updated = await this.dataSource.transaction(
      async (manager) => {
        const order = await this.lockOrder(manager, id);

        this.assertParticipant(order, actor);

        const party = this.partyOf(order, actor);

        const rule = DELIVERY_RULES[dto.status].find(
          (r) => r.from === order.status,
        );

        if (!rule) {
          throw new ConflictException(
            `No se puede registrar ${dto.status} sobre una orden en estado ${order.status}`,
          );
        }

        if (!rule.by.includes(party)) {
          throw new ForbiddenException(
            'No tienes permisos para registrar este cambio en la orden',
          );
        }

        const now = new Date();

        order.status = OrderStatus[dto.status];
        order.closedAt = now;

        if (dto.status === DeliveryAction.DELIVERED) {
          order.deliveredAt = now;
        }

        if (dto.notes !== undefined) {
          order.notes = dto.notes;
        }

        const saved = await manager.save(order);

        this.logger.log(
          `Orden ${saved.id}: ${dto.status} registrado por usuario ${actor.id} (${party})`,
        );

        return saved;
      },
    );

    this.realtime.publishOrder('updated', updated);

    return updated;
  }

  /**
   * Marca como DEFAULTED las órdenes sin pagar cuyo plazo venció.
   * Devuelve cuántas venció. Sin plazo configurado no hace nada.
   */
  async expireOverdueOrders(): Promise<number> {
    const overdue = await this.ordersRepository.find({
      select: { id: true },
      where: {
        status: In([
          OrderStatus.PENDING_PAYMENT,
          OrderStatus.PAYMENT_REJECTED,
        ]),
        paymentDueAt: LessThanOrEqual(new Date()),
      },
    });

    let expired = 0;

    for (const { id } of overdue) {
      try {
        const order = await this.dataSource.transaction(
          async (manager) => {
            const locked = await this.lockOrder(manager, id);

            // Otro proceso la pagó o cerró mientras tanto
            if (
              (locked.status !== OrderStatus.PENDING_PAYMENT &&
                locked.status !== OrderStatus.PAYMENT_REJECTED) ||
              !locked.paymentDueAt ||
              locked.paymentDueAt.getTime() > Date.now()
            ) {
              return null;
            }

            locked.status = OrderStatus.DEFAULTED;
            locked.closedAt = new Date();
            locked.notes = 'Vencido el plazo de pago';

            return manager.save(locked);
          },
        );

        if (order) {
          expired += 1;

          this.logger.log(
            `Orden ${order.id}: plazo de pago vencido -> DEFAULTED`,
          );

          this.realtime.publishOrder('updated', order);
        }
      } catch (error) {
        this.logger.error(
          `No se pudo vencer la orden ${id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return expired;
  }

  private async lockOrder(
    manager: EntityManager,
    id: number,
  ): Promise<Order> {
    const order = await manager.findOne(Order, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!order) {
      throw new NotFoundException(
        'Orden no encontrada',
      );
    }

    return order;
  }

  private partyOf(
    order: Order,
    actor: OrderActor,
  ): Party {
    if (actor.role === Role.ADMIN) return 'admin';
    if (order.buyerId === actor.id) return 'buyer';
    return 'seller';
  }

  private assertParticipant(
    order: Order,
    actor: OrderActor,
  ): void {
    if (
      actor.role !== Role.ADMIN &&
      order.buyerId !== actor.id &&
      order.sellerId !== actor.id
    ) {
      throw new ForbiddenException(
        'No tienes acceso a esta orden',
      );
    }
  }
}
