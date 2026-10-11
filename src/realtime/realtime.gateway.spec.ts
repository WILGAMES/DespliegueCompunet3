import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';

import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

import { SocketIoAdapter } from '../common/socket-io.adapter';
import { Role } from '../users/enums/role.enum';
import { UsersService } from '../users/users.service';

/**
 * Prueba de extremo a extremo del tiempo real con un servidor Socket.IO
 * real y clientes reales, sin base de datos (JWT y usuarios simulados).
 */
describe('Realtime (Socket.IO)', () => {
  let app: INestApplication;
  let realtime: RealtimeService;
  let url: string;

  const clients: Socket[] = [];

  const users: Record<number, Record<string, unknown>> = {
    1: { id: 1, email: 'admin@x.com', role: Role.ADMIN, isActive: true, tokenVersion: 0 },
    10: { id: 10, email: 'seller@x.com', role: Role.USER, isActive: true, tokenVersion: 0 },
    20: { id: 20, email: 'buyer@x.com', role: Role.USER, isActive: true, tokenVersion: 0 },
    30: { id: 30, email: 'other@x.com', role: Role.USER, isActive: true, tokenVersion: 0 },
  };

  // El "token" es el id del usuario; verifyAsync devuelve el payload
  const jwtMock = {
    verifyAsync: jest.fn(async (token: string) => {
      const user = users[Number(token)];

      if (!user) throw new Error('jwt malformed');

      return {
        sub: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: 0,
      };
    }),
  };

  const usersMock = {
    findByIdWithPassword: jest.fn(async (id: number) => users[id]),
  };

  const auction = {
    id: 5,
    listingId: 7,
    sellerId: 10,
    winnerId: 20,
    status: 'FINISHED',
    currentPrice: '1650000.00',
    startsAt: new Date(),
    endsAt: new Date(),
    cancelReason: null,
  } as any;

  const order = {
    id: 3,
    auctionId: 5,
    buyerId: 20,
    sellerId: 10,
    amount: 1650000,
    status: 'PENDING_PAYMENT',
    paymentDueAt: null,
    updatedAt: new Date(),
  } as any;

  const connect = (auth?: Record<string, string>): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const socket = io(url, {
        auth,
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });

      clients.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });

  const emitAck = (socket: Socket, event: string, body?: unknown) =>
    socket.timeout(2000).emitWithAck(event, body);

  const collect = (socket: Socket, event: string) => {
    const received: any[] = [];

    socket.on(event, (payload) => received.push(payload));

    return received;
  };

  const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeService,
        RealtimeGateway,
        { provide: JwtService, useValue: jwtMock },
        { provide: UsersService, useValue: usersMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new SocketIoAdapter(app, true));
    await app.listen(0);

    realtime = app.get(RealtimeService);

    const { port } = app.getHttpServer().address();
    url = `http://localhost:${port}`;
  });

  afterEach(() => {
    clients.splice(0).forEach((c) => c.disconnect());
    users[20].isActive = true;
    users[20].tokenVersion = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('un cliente anónimo recibe las pujas de la subasta a la que se une', async () => {
    const client = await connect();
    const bids = collect(client, 'bid:new');

    await expect(
      emitAck(client, 'auction:join', { auctionId: 5 }),
    ).resolves.toMatchObject({ ok: true });

    realtime.publishBid(
      { ...auction, id: 5, currentPrice: 1550000 },
      { id: 1, bidderId: 20, amount: 1550000, createdAt: new Date() } as any,
    );

    await tick();

    expect(bids).toHaveLength(1);
    expect(bids[0]).toMatchObject({
      auctionId: 5,
      currentPrice: 1550000,
      bid: { id: 1, bidderId: 20, amount: 1550000 },
    });
  });

  it('no recibe pujas de otra subasta ni después de salir de la sala', async () => {
    const client = await connect();
    const bids = collect(client, 'bid:new');

    await emitAck(client, 'auction:join', { auctionId: 5 });

    realtime.publishBid(
      { ...auction, id: 6 },
      { id: 9, bidderId: 20, amount: 1, createdAt: new Date() } as any,
    );
    await tick();
    expect(bids).toHaveLength(0);

    await emitAck(client, 'auction:leave', { auctionId: 5 });

    realtime.publishBid(
      { ...auction, id: 5 },
      { id: 10, bidderId: 20, amount: 1, createdAt: new Date() } as any,
    );
    await tick();
    expect(bids).toHaveLength(0);
  });

  it('rechaza un auctionId inválido sin romper la conexión', async () => {
    const client = await connect();

    for (const bad of [undefined, 'abc', -1, 0, 1.5]) {
      await expect(
        emitAck(client, 'auction:join', { auctionId: bad }),
      ).resolves.toMatchObject({ ok: false });
    }

    expect(client.connected).toBe(true);
  });

  it('auctions:watch entrega los cambios de estado de cualquier subasta', async () => {
    const client = await connect();
    const statuses = collect(client, 'auction:status');

    await emitAck(client, 'auctions:watch');

    realtime.publishAuctionStatus({ ...auction, id: 11 });
    realtime.publishAuctionStatus({ ...auction, id: 12 });

    await tick();

    expect(statuses.map((s) => s.auctionId)).toEqual([11, 12]);
  });

  it('el resultado del cierre solo llega al vendedor y al ganador', async () => {
    const seller = await connect({ token: '10' });
    const buyer = await connect({ token: '20' });
    const other = await connect({ token: '30' });
    const anonymous = await connect();

    const received = [seller, buyer, other, anonymous].map((c) =>
      collect(c, 'auction:result'),
    );

    realtime.publishAuctionResult(auction, order);

    await tick();

    expect(received.map((r) => r.length)).toEqual([1, 1, 0, 0]);
    expect(received[1][0]).toMatchObject({
      auctionId: 5,
      winnerId: 20,
      finalPrice: 1650000,
      orderId: 3,
    });
  });

  it('las órdenes llegan al comprador, al vendedor y a los administradores', async () => {
    const seller = await connect({ token: '10' });
    const buyer = await connect({ token: '20' });
    const admin = await connect({ token: '1' });
    const other = await connect({ token: '30' });

    const received = [seller, buyer, admin, other].map((c) =>
      collect(c, 'order:updated'),
    );

    realtime.publishOrder('updated', order);

    await tick();

    expect(received.map((r) => r.length)).toEqual([1, 1, 1, 0]);
    expect(received[0][0]).toMatchObject({
      orderId: 3,
      status: 'PENDING_PAYMENT',
      amount: 1650000,
    });
  });

  it('un socket recibe una sola vez un evento dirigido a varias de sus salas', async () => {
    // El vendedor está en user:10 (autenticado) y además en la sala de la subasta
    const seller = await connect({ token: '10' });
    const created = collect(seller, 'order:created');

    realtime.publishOrder('created', { ...order, buyerId: 10 });

    await tick();

    expect(created).toHaveLength(1);
  });

  it('acepta el token en la cabecera Authorization', async () => {
    const socket = io(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Authorization: 'Bearer 20' },
    });

    clients.push(socket);

    const orders = collect(socket, 'order:updated');

    await new Promise<void>((resolve) => socket.once('connect', resolve));
    await tick();

    realtime.publishOrder('updated', order);
    await tick();

    expect(orders).toHaveLength(1);
  });

  /** Conecta y espera el rechazo (el listener se registra antes de conectar). */
  const connectRejected = (token: string) =>
    new Promise<{ message: string; connected: boolean }>((resolve) => {
      const socket = io(url, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });

      clients.push(socket);

      let error: { message: string } | undefined;

      socket.once('auth:error', (payload) => {
        error = payload;
      });

      socket.once('disconnect', () =>
        resolve({
          message: error?.message ?? '',
          connected: socket.connected,
        }),
      );
    });

  it('desconecta con auth:error cuando el token es inválido', async () => {
    const result = await connectRejected('999');

    expect(result.message).toBe('Token inválido o vencido');
    expect(result.connected).toBe(false);
  });

  it('desconecta si el usuario fue suspendido o cerró sesión (token invalidado)', async () => {
    users[20].isActive = false;

    await expect(connectRejected('20')).resolves.toMatchObject({
      message: 'Token inválido o vencido',
    });

    users[20].isActive = true;
    users[20].tokenVersion = 1; // logout: el token firmado con versión 0 ya no sirve

    await expect(connectRejected('20')).resolves.toMatchObject({
      message: 'Token inválido o vencido',
    });
  });

  it('un fallo al emitir no afecta a quien publica', () => {
    const broken = new RealtimeService();

    broken.setServer({
      to: () => {
        throw new Error('socket roto');
      },
    } as any);

    expect(() => broken.publishOrder('updated', order)).not.toThrow();
    expect(() => new RealtimeService().publishOrder('updated', order)).not.toThrow();
  });
});
