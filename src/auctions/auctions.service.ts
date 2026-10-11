import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  LessThanOrEqual,
  MoreThan,
  Repository,
} from 'typeorm';

import { Auction } from './entities/auction.entity';
import { AuctionStatus } from './enums/auction-status.enum';
import { CreateAuctionDto } from './dto/create-auction.dto';

import { Bid } from '../bids/entities/bid.entity';
import { BidStatus } from '../bids/enums/bid-status.enum';
import { Listing } from '../listings/entities/listing.entity';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { Order } from '../orders/entities/order.entity';
import { OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  AuctionNotFoundException,
  ListingNotFoundException,
} from '../common/exceptions';

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(
    AuctionsService.name,
  );

  constructor(
    @InjectRepository(Auction)
    private readonly auctionsRepository: Repository<Auction>,

    private readonly dataSource: DataSource,

    private readonly ordersService: OrdersService,

    private readonly realtime: RealtimeService,
  ) {}

  async create(
    createAuctionDto: CreateAuctionDto,
    sellerId: number,
  ): Promise<Auction> {
    const created = await this.dataSource.transaction(
      async (manager) => {
        // Se bloquea la publicación para que dos peticiones simultáneas
        // no creen dos subastas sobre la misma publicación.
        const listing = await manager.findOne(
          Listing,
          {
            where: {
              id: createAuctionDto.listingId,
            },
            lock: { mode: 'pessimistic_write' },
          },
        );

        if (!listing) {
          throw new ListingNotFoundException(
            createAuctionDto.listingId,
          );
        }

        if (listing.sellerId !== sellerId) {
          throw new ForbiddenException(
            'No puedes crear una subasta para una publicación que no te pertenece',
          );
        }

        if (
          listing.status !== ListingStatus.APPROVED
        ) {
          throw new BadRequestException(
            'La publicación debe estar aprobada para crear una subasta',
          );
        }

        const existingAuction =
          await manager.findOne(Auction, {
            where: { listingId: listing.id },
          });

        if (existingAuction) {
          throw new ConflictException(
            'Esta publicación ya tiene una subasta',
          );
        }

        const startsAt = new Date(
          createAuctionDto.startsAt,
        );

        const endsAt = new Date(
          createAuctionDto.endsAt,
        );

        if (
          Number.isNaN(startsAt.getTime()) ||
          Number.isNaN(endsAt.getTime())
        ) {
          throw new BadRequestException(
            'Las fechas de la subasta no son válidas',
          );
        }

        if (startsAt >= endsAt) {
          throw new BadRequestException(
            'La fecha de inicio debe ser anterior a la fecha de finalización',
          );
        }

        const now = new Date();

        if (endsAt <= now) {
          throw new BadRequestException(
            'La fecha de finalización debe ser futura',
          );
        }

        const durationHours =
          (endsAt.getTime() - startsAt.getTime()) /
          (1000 * 60 * 60);

        if (
          durationHours < 1 ||
          durationHours > 24
        ) {
          throw new BadRequestException(
            'La duración de la subasta debe estar entre 1 y 24 horas',
          );
        }

        const status =
          startsAt <= now
            ? AuctionStatus.ACTIVE
            : AuctionStatus.SCHEDULED;

        const auction = await manager.save(
          manager.create(Auction, {
            listingId: listing.id,
            sellerId,
            startingPrice: Number(
              listing.initialPrice,
            ),
            minimumIncrement: Number(
              listing.minimumIncrement,
            ),
            currentPrice: Number(
              listing.initialPrice,
            ),
            winnerId: null,
            status,
            startsAt,
            endsAt,
          }),
        );

        // La publicación sigue el ciclo de vida de la subasta
        listing.status =
          status === AuctionStatus.ACTIVE
            ? ListingStatus.ACTIVE
            : ListingStatus.SCHEDULED;

        await manager.save(listing);

        return auction;
      },
    );

    this.realtime.publishAuctionStatus(created);

    return created;
  }

  async findAll(): Promise<Auction[]> {
    return this.auctionsRepository.find({
      order: { id: 'DESC' },
    });
  }

  /** Subastas en curso: activas y que aún no han llegado a su fin. */
  async findActive(): Promise<Auction[]> {
    return this.auctionsRepository.find({
      where: {
        status: AuctionStatus.ACTIVE,
        endsAt: MoreThan(new Date()),
      },
      order: { endsAt: 'ASC' },
    });
  }

  async findOne(id: number): Promise<Auction> {
    const auction =
      await this.auctionsRepository.findOne({
        where: { id },
      });

    if (!auction) {
      throw new AuctionNotFoundException(id);
    }

    return auction;
  }

  async findMine(
    sellerId: number,
  ): Promise<Auction[]> {
    return this.auctionsRepository.find({
      where: { sellerId },
      order: { id: 'DESC' },
    });
  }

  async cancel(
    id: number,
    sellerId: number,
  ): Promise<Auction> {
    const cancelled = await this.dataSource.transaction(
      async (manager) => {
        // Bloqueada: una oferta simultánea no puede colarse mientras se cancela
        const auction = await manager.findOne(
          Auction,
          {
            where: { id },
            lock: { mode: 'pessimistic_write' },
          },
        );

        if (!auction) {
          throw new AuctionNotFoundException(id);
        }

        if (auction.sellerId !== sellerId) {
          throw new ForbiddenException(
            'No puedes cancelar una subasta que no te pertenece',
          );
        }

        if (
          auction.status ===
          AuctionStatus.FINISHED
        ) {
          throw new ConflictException(
            'No puedes cancelar una subasta finalizada',
          );
        }

        if (
          auction.status ===
          AuctionStatus.CANCELLED
        ) {
          throw new ConflictException(
            'La subasta ya está cancelada',
          );
        }

        const hasBids = await manager.exists(
          Bid,
          {
            where: {
              auctionId: id,
              status: BidStatus.VALID,
            },
          },
        );

        if (hasBids) {
          throw new ConflictException(
            'No puedes cancelar una subasta que ya tiene ofertas',
          );
        }

        auction.status = AuctionStatus.CANCELLED;

        await manager.update(
          Listing,
          { id: auction.listingId },
          { status: ListingStatus.CANCELLED },
        );

        return manager.save(auction);
      },
    );

    this.realtime.publishAuctionStatus(cancelled);

    return cancelled;
  }

  /**
   * Cancelación por un administrador. A diferencia de la del vendedor,
   * puede cancelar una subasta con ofertas: las ofertas quedan CANCELLED,
   * no hay ganador ni orden, y la publicación pasa a CANCELLED.
   */
  async adminCancel(
    id: number,
    adminId: number,
    reason?: string,
  ): Promise<Auction> {
    const cancelled = await this.dataSource.transaction(
      (manager) =>
        this.forceCancel(manager, id, {
          adminId,
          reason,
          listingStatus: ListingStatus.CANCELLED,
        }),
    );

    this.realtime.publishAuctionStatus(cancelled);

    return cancelled;
  }

  /**
   * Cancela una subasta no finalizada dentro de la transacción del
   * llamador. No emite eventos: quien confirma la transacción debe llamar
   * a `realtime.publishAuctionStatus` con la subasta devuelta.
   */
  async forceCancel(
    manager: EntityManager,
    id: number,
    options: {
      adminId: number;
      reason?: string;
      listingStatus: ListingStatus;
    },
  ): Promise<Auction> {
    const auction = await manager.findOne(Auction, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!auction) {
      throw new AuctionNotFoundException(id);
    }

    if (auction.status === AuctionStatus.FINISHED) {
      throw new ConflictException(
        'No puedes cancelar una subasta finalizada',
      );
    }

    if (auction.status === AuctionStatus.CANCELLED) {
      throw new ConflictException(
        'La subasta ya está cancelada',
      );
    }

    await manager.update(
      Bid,
      { auctionId: id, status: BidStatus.VALID },
      { status: BidStatus.CANCELLED },
    );

    await manager.update(
      Listing,
      { id: auction.listingId },
      { status: options.listingStatus },
    );

    auction.status = AuctionStatus.CANCELLED;
    auction.winnerId = null;
    auction.cancelReason = options.reason?.trim() || null;
    auction.cancelledById = options.adminId;

    return manager.save(auction);
  }

  /**
   * Pasa a ACTIVE las subastas programadas cuya hora de inicio ya llegó.
   * Devuelve cuántas activó.
   */
  async activateDueAuctions(): Promise<number> {
    const due =
      await this.auctionsRepository.find({
        select: { id: true },
        where: {
          status: AuctionStatus.SCHEDULED,
          startsAt: LessThanOrEqual(new Date()),
          endsAt: MoreThan(new Date()),
        },
      });

    let activated = 0;

    for (const { id } of due) {
      try {
        const changed =
          await this.dataSource.transaction(
            async (manager) => {
              const auction =
                await manager.findOne(Auction, {
                  where: { id },
                  lock: {
                    mode: 'pessimistic_write',
                  },
                });

              // Otro proceso (o una oferta) ya la activó o cambió
              if (
                !auction ||
                auction.status !==
                  AuctionStatus.SCHEDULED
              ) {
                return null;
              }

              auction.status =
                AuctionStatus.ACTIVE;

              await manager.save(auction);

              await manager.update(
                Listing,
                { id: auction.listingId },
                { status: ListingStatus.ACTIVE },
              );

              return auction;
            },
          );

        if (changed) {
          activated += 1;
          this.realtime.publishAuctionStatus(changed);
        }
      } catch (error) {
        this.logger.error(
          `No se pudo activar la subasta ${id}`,
          error instanceof Error
            ? error.stack
            : String(error),
        );
      }
    }

    return activated;
  }

  /**
   * Finaliza las subastas vencidas: define el ganador, marca la
   * publicación como FINISHED y genera la orden de pago.
   * Devuelve cuántas cerró.
   */
  async closeDueAuctions(): Promise<number> {
    const due =
      await this.auctionsRepository.find({
        select: { id: true },
        where: {
          status: In([
            AuctionStatus.SCHEDULED,
            AuctionStatus.ACTIVE,
          ]),
          endsAt: LessThanOrEqual(new Date()),
        },
        order: { endsAt: 'ASC' },
      });

    let closed = 0;

    for (const { id } of due) {
      try {
        if (await this.closeAuction(id)) {
          closed += 1;
        }
      } catch (error) {
        // Una subasta con problemas no debe impedir cerrar las demás;
        // se reintenta en la siguiente ejecución.
        this.logger.error(
          `No se pudo cerrar la subasta ${id}`,
          error instanceof Error
            ? error.stack
            : String(error),
        );
      }
    }

    return closed;
  }

  /**
   * Cierra una subasta vencida dentro de una única transacción:
   * ganador + estado + publicación + orden se guardan juntos o no se
   * guarda nada. Es idempotente: si ya estaba cerrada devuelve null.
   */
  async closeAuction(
    id: number,
  ): Promise<Auction | null> {
    let order: Order | null = null;
    let orderCreated = false;

    const closed = await this.dataSource.transaction(
      async (manager) => {
        const auction = await manager.findOne(
          Auction,
          {
            where: { id },
            lock: { mode: 'pessimistic_write' },
          },
        );

        if (!auction) {
          throw new AuctionNotFoundException(id);
        }

        if (
          auction.status ===
            AuctionStatus.FINISHED ||
          auction.status ===
            AuctionStatus.CANCELLED
        ) {
          return null;
        }

        if (auction.endsAt > new Date()) {
          return null;
        }

        // Oferta más alta; ante empate gana la más antigua
        const winningBid = await manager.findOne(
          Bid,
          {
            where: {
              auctionId: id,
              status: BidStatus.VALID,
            },
            order: {
              amount: 'DESC',
              createdAt: 'ASC',
            },
          },
        );

        auction.status = AuctionStatus.FINISHED;

        if (winningBid) {
          auction.winnerId = winningBid.bidderId;
          auction.currentPrice = Number(
            winningBid.amount,
          );
        }

        const saved = await manager.save(auction);

        await manager.update(
          Listing,
          { id: auction.listingId },
          { status: ListingStatus.FINISHED },
        );

        if (winningBid) {
          const result =
            await this.ordersService.createForAuction(
              id,
              manager,
            );

          order = result?.order ?? null;
          orderCreated = result?.created ?? false;
        }

        this.logger.log(
          winningBid
            ? `Subasta ${id} finalizada. Ganador: usuario ${winningBid.bidderId}`
            : `Subasta ${id} finalizada sin ofertas`,
        );

        return saved;
      },
    );

    // Después del commit: estado, resultado para vendedor y ganador, y orden
    if (closed) {
      this.realtime.publishAuctionStatus(closed);
      this.realtime.publishAuctionResult(closed, order);

      if (order && orderCreated) {
        this.realtime.publishOrder('created', order);
      }
    }

    return closed;
  }
}
