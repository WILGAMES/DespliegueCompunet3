import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import { ServerEvents, Rooms } from './realtime.events';

import type { Auction } from '../auctions/entities/auction.entity';
import type { Bid } from '../bids/entities/bid.entity';
import type { Order } from '../orders/entities/order.entity';

/**
 * Publica eventos de negocio por Socket.IO.
 *
 * Los servicios de negocio lo llaman DESPUÉS de confirmar la transacción.
 * Nunca lanza: si el servidor de sockets no está listo o falla un emit,
 * la operación de negocio no se ve afectada.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  private server?: Server;

  setServer(server: Server): void {
    this.server = server;
  }

  publishBid(auction: Auction, bid: Bid): void {
    this.emit([Rooms.auction(auction.id)], ServerEvents.BID_NEW, {
      auctionId: auction.id,
      bid: {
        id: bid.id,
        bidderId: bid.bidderId,
        amount: Number(bid.amount),
        createdAt: bid.createdAt,
      },
      currentPrice: Number(auction.currentPrice),
      endsAt: auction.endsAt,
    });
  }

  publishAuctionStatus(auction: Auction): void {
    this.emit(
      [Rooms.auction(auction.id), Rooms.AUCTIONS],
      ServerEvents.AUCTION_STATUS,
      {
        auctionId: auction.id,
        listingId: auction.listingId,
        status: auction.status,
        currentPrice: Number(auction.currentPrice),
        winnerId: auction.winnerId ?? null,
        startsAt: auction.startsAt,
        endsAt: auction.endsAt,
        cancelReason: auction.cancelReason ?? null,
      },
    );
  }

  /** Avisa al vendedor y al ganador (si lo hay) del resultado del cierre. */
  publishAuctionResult(auction: Auction, order: Order | null): void {
    const rooms: string[] = [Rooms.user(auction.sellerId)];

    if (auction.winnerId) rooms.push(Rooms.user(auction.winnerId));

    this.emit(rooms, ServerEvents.AUCTION_RESULT, {
      auctionId: auction.id,
      listingId: auction.listingId,
      sellerId: auction.sellerId,
      winnerId: auction.winnerId ?? null,
      finalPrice: Number(auction.currentPrice),
      orderId: order?.id ?? null,
    });
  }

  publishOrder(kind: 'created' | 'updated', order: Order): void {
    this.emit(
      [
        Rooms.user(order.buyerId),
        Rooms.user(order.sellerId),
        Rooms.ADMINS,
      ],
      kind === 'created'
        ? ServerEvents.ORDER_CREATED
        : ServerEvents.ORDER_UPDATED,
      {
        orderId: order.id,
        auctionId: order.auctionId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        amount: Number(order.amount),
        status: order.status,
        paymentDueAt: order.paymentDueAt ?? null,
        updatedAt: order.updatedAt,
      },
    );
  }

  private emit(rooms: string[], event: string, payload: unknown): void {
    if (!this.server) return;

    try {
      // Un solo emit a la unión de salas: un socket que esté en varias
      // recibe el evento una única vez.
      this.server.to(rooms).emit(event, payload);
    } catch (error) {
      this.logger.error(
        `No se pudo emitir ${event}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
