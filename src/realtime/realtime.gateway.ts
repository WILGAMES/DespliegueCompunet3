import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { ClientEvents, Rooms, ServerEvents } from './realtime.events';
import { RealtimeService } from './realtime.service';

import { Role } from '../users/enums/role.enum';
import { UsersService } from '../users/users.service';

interface TokenPayload {
  sub: number;
  email: string;
  role: Role;
  tokenVersion: number;
}

/**
 * Gateway Socket.IO.
 *
 * - Sin token: conexión anónima; puede seguir subastas (solo lectura).
 * - Con token JWT válido (`auth: { token }` o cabecera Authorization):
 *   además recibe sus eventos privados (órdenes y resultados de cierre).
 * - Un token inválido, vencido o invalidado (logout, suspensión, cambio de
 *   rol) desconecta al cliente con `auth:error`.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.setServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);

    if (!token) return;

    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(token);

      const user = await this.usersService.findByIdWithPassword(payload.sub);

      if (
        !user.isActive ||
        user.tokenVersion !== payload.tokenVersion ||
        user.role !== payload.role ||
        user.email !== payload.email
      ) {
        throw new Error('Token no vigente');
      }

      client.data.user = { id: user.id, role: user.role };

      await client.join(Rooms.user(user.id));

      if (user.role === Role.ADMIN) await client.join(Rooms.ADMINS);
    } catch (error) {
      this.logger.debug(
        `Conexión rechazada: ${error instanceof Error ? error.message : error}`,
      );

      client.emit(ServerEvents.AUTH_ERROR, {
        message: 'Token inválido o vencido',
      });
      client.disconnect(true);
    }
  }

  @SubscribeMessage(ClientEvents.AUCTION_JOIN)
  async joinAuction(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { auctionId?: unknown },
  ) {
    const id = this.parseId(body?.auctionId);

    if (!id) return { ok: false, error: 'auctionId inválido' };

    await client.join(Rooms.auction(id));

    return { ok: true, room: Rooms.auction(id) };
  }

  @SubscribeMessage(ClientEvents.AUCTION_LEAVE)
  async leaveAuction(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { auctionId?: unknown },
  ) {
    const id = this.parseId(body?.auctionId);

    if (!id) return { ok: false, error: 'auctionId inválido' };

    await client.leave(Rooms.auction(id));

    return { ok: true };
  }

  @SubscribeMessage(ClientEvents.AUCTIONS_WATCH)
  async watchAuctions(@ConnectedSocket() client: Socket) {
    await client.join(Rooms.AUCTIONS);

    return { ok: true, room: Rooms.AUCTIONS };
  }

  @SubscribeMessage(ClientEvents.AUCTIONS_UNWATCH)
  async unwatchAuctions(@ConnectedSocket() client: Socket) {
    await client.leave(Rooms.AUCTIONS);

    return { ok: true };
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;

    if (typeof fromAuth === 'string' && fromAuth.trim()) {
      return fromAuth.replace(/^Bearer\s+/i, '').trim();
    }

    const header = client.handshake.headers.authorization;

    if (typeof header === 'string' && /^Bearer\s+/i.test(header)) {
      return header.replace(/^Bearer\s+/i, '').trim();
    }

    return null;
  }

  private parseId(value: unknown): number | null {
    const id = Number(value);

    return Number.isInteger(id) && id > 0 ? id : null;
  }
}
