import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/common/setup-app';
import { AiService } from '../src/listings/ai/ai.service';
import { AuctionsService } from '../src/auctions/auctions.service';
import { Auction } from '../src/auctions/entities/auction.entity';
import { AuctionStatus } from '../src/auctions/enums/auction-status.enum';
import { Bid } from '../src/bids/entities/bid.entity';
import { BidStatus } from '../src/bids/enums/bid-status.enum';
import { Listing } from '../src/listings/entities/listing.entity';
import { ListingStatus } from '../src/listings/enums/listing-status.enum';
import { Order } from '../src/orders/entities/order.entity';

/**
 * Moderación del administrador (cancelar subastas, suspender publicaciones)
 * y eventos en tiempo real con un servidor Socket.IO real.
 */
describe('Moderación y tiempo real E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let auctionsService: AuctionsService;
  let baseUrl: string;

  const timestamp = Date.now();
  const password = 'Test12345';
  const HOUR = 3_600_000;

  const adminEmail =
    process.env.SEED_ADMIN_EMAIL ?? 'admin@colsubastas.com';
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD ?? 'Admin12345';

  const users = {
    seller: { email: `mod-seller-${timestamp}@test.com`, token: '', id: 0 },
    alice: { email: `mod-alice-${timestamp}@test.com`, token: '', id: 0 },
    bob: { email: `mod-bob-${timestamp}@test.com`, token: '', id: 0 },
    admin: { email: adminEmail, token: '', id: 0 },
  };

  const aiServiceMock = {
    validateListing: jest.fn().mockResolvedValue({
      decision: 'APPROVE',
      risk: 'LOW',
      reason: 'Producto válido',
      confidence: 0.95,
    }),
  };

  const sockets: Socket[] = [];

  const auth = (token: string) => ({
    Authorization: `Bearer ${token}`,
  });

  const http = () => request(app.getHttpServer());

  async function createListing(label: string) {
    const res = await http()
      .post('/listings')
      .set(auth(users.seller.token))
      .send({
        title: `Producto Mod ${label} ${timestamp}`,
        description:
          'Producto creado para probar moderación y eventos en tiempo real.',
        category: 'Tecnología',
        initialPrice: 1000000,
        minimumIncrement: 50000,
        durationHours: 12,
      })
      .expect(201);

    return res.body.id as number;
  }

  async function createAuction(label: string) {
    const listingId = await createListing(label);

    const res = await http()
      .post('/auctions')
      .set(auth(users.seller.token))
      .send({
        listingId,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 6 * HOUR).toISOString(),
      })
      .expect(201);

    return { auctionId: res.body.id as number, listingId };
  }

  const bid = (auctionId: number, token: string, amount: number) =>
    http()
      .post(`/auctions/${auctionId}/bids`)
      .set(auth(token))
      .send({ amount });

  const expire = (auctionId: number) =>
    dataSource
      .getRepository(Auction)
      .update({ id: auctionId }, { endsAt: new Date(Date.now() - 1000) });

  /** Conecta y deja un colector por evento; espera a estar autenticado. */
  async function connect(token?: string) {
    const socket = io(baseUrl, {
      auth: token ? { token } : undefined,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

    sockets.push(socket);

    const events: Record<string, any[]> = {};

    socket.onAny((event, payload) => {
      (events[event] ??= []).push(payload);
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });

    // La autenticación del socket es asíncrona: se espera a que termine
    await new Promise((r) => setTimeout(r, 300));

    return { socket, events };
  }

  /** Espera hasta que se cumpla la condición (o falla a los 4 s). */
  async function eventually(check: () => boolean, label: string) {
    const limit = Date.now() + 4000;

    while (Date.now() < limit) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }

    throw new Error(`No ocurrió a tiempo: ${label}`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AiService)
      .useValue(aiServiceMock)
      .compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.listen(0);

    baseUrl = await app.getUrl();
    dataSource = app.get(DataSource);
    auctionsService = app.get(AuctionsService);

    for (const key of ['seller', 'alice', 'bob'] as const) {
      const registered = await http()
        .post('/auth/register')
        .send({ name: `Mod ${key}`, email: users[key].email, password })
        .expect(201);

      users[key].id = registered.body.id;
    }

    for (const key of Object.keys(users) as (keyof typeof users)[]) {
      const login = await http()
        .post('/auth/login')
        .send({
          email: users[key].email,
          password: key === 'admin' ? adminPassword : password,
        })
        .expect(201);

      users[key].token = login.body.access_token;
      users[key].id = login.body.user.id;
    }
  });

  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('admin cancela subastas', () => {
    it('requiere autenticación y rol de administrador', async () => {
      const { auctionId } = await createAuction('admin-auth');

      await http().patch(`/admin/auctions/${auctionId}/cancel`).expect(401);

      await http()
        .patch(`/admin/auctions/${auctionId}/cancel`)
        .set(auth(users.seller.token))
        .send({})
        .expect(403);
    });

    it('cancela una subasta con ofertas: ofertas canceladas, sin ganador ni orden', async () => {
      const { auctionId, listingId } = await createAuction('admin-cancel');

      await bid(auctionId, users.alice.token, 1050000).expect(201);
      await bid(auctionId, users.bob.token, 1100000).expect(201);

      // El vendedor, en cambio, no puede cancelar una subasta con ofertas
      await http()
        .patch(`/auctions/${auctionId}/cancel`)
        .set(auth(users.seller.token))
        .expect(409);

      const res = await http()
        .patch(`/admin/auctions/${auctionId}/cancel`)
        .set(auth(users.admin.token))
        .send({ reason: 'Sospecha de fraude' })
        .expect(200);

      expect(res.body).toMatchObject({
        status: AuctionStatus.CANCELLED,
        winnerId: null,
        cancelReason: 'Sospecha de fraude',
        cancelledById: users.admin.id,
      });

      const bids = await dataSource
        .getRepository(Bid)
        .find({ where: { auctionId } });

      expect(bids).toHaveLength(2);
      expect(bids.every((b) => b.status === BidStatus.CANCELLED)).toBe(true);

      const listing = await dataSource
        .getRepository(Listing)
        .findOneByOrFail({ id: listingId });

      expect(listing.status).toBe(ListingStatus.CANCELLED);

      // Ya no admite ofertas ni genera orden aunque se intente cerrar
      await bid(auctionId, users.alice.token, 1200000).expect(400);

      await expire(auctionId);
      await auctionsService.closeAuction(auctionId);

      expect(
        await dataSource.getRepository(Order).countBy({ auctionId }),
      ).toBe(0);
    });

    it('no cancela una subasta ya cancelada, finalizada o inexistente', async () => {
      const { auctionId } = await createAuction('admin-twice');

      await http()
        .patch(`/admin/auctions/${auctionId}/cancel`)
        .set(auth(users.admin.token))
        .send({})
        .expect(200);

      await http()
        .patch(`/admin/auctions/${auctionId}/cancel`)
        .set(auth(users.admin.token))
        .send({})
        .expect(409);

      const finished = await createAuction('admin-finished');

      await bid(finished.auctionId, users.alice.token, 1050000).expect(201);
      await expire(finished.auctionId);
      await auctionsService.closeAuction(finished.auctionId);

      await http()
        .patch(`/admin/auctions/${finished.auctionId}/cancel`)
        .set(auth(users.admin.token))
        .send({})
        .expect(409);

      await http()
        .patch('/admin/auctions/99999999/cancel')
        .set(auth(users.admin.token))
        .send({})
        .expect(404);

      await http()
        .patch('/admin/auctions/abc/cancel')
        .set(auth(users.admin.token))
        .send({})
        .expect(400);
    });
  });

  describe('admin suspende publicaciones', () => {
    it('solo un administrador puede suspender', async () => {
      const listingId = await createListing('suspend-auth');

      await http().patch(`/admin/listings/${listingId}/suspend`).expect(401);

      await http()
        .patch(`/admin/listings/${listingId}/suspend`)
        .set(auth(users.seller.token))
        .send({})
        .expect(403);
    });

    it('suspende una publicación con subasta activa: la cancela y la oculta', async () => {
      const { auctionId, listingId } = await createAuction('suspend-active');

      await bid(auctionId, users.alice.token, 1050000).expect(201);

      const res = await http()
        .patch(`/admin/listings/${listingId}/suspend`)
        .set(auth(users.admin.token))
        .send({ reason: 'Contenido engañoso' })
        .expect(200);

      expect(res.body).toMatchObject({
        status: ListingStatus.SUSPENDED,
        reviewReason: 'Contenido engañoso',
        reviewedById: users.admin.id,
      });

      const auction = await dataSource
        .getRepository(Auction)
        .findOneByOrFail({ id: auctionId });

      expect(auction.status).toBe(AuctionStatus.CANCELLED);
      expect(auction.cancelReason).toBe('Contenido engañoso');

      // Oculta al público
      await http().get(`/listings/${listingId}`).expect(404);

      const list = await http().get('/listings').expect(200);

      expect(
        list.body.map((l: { id: number }) => l.id),
      ).not.toContain(listingId);

      // El vendedor no puede editarla para saltarse la suspensión
      await http()
        .patch(`/listings/${listingId}`)
        .set(auth(users.seller.token))
        .send({ title: 'Título nuevo y distinto' })
        .expect(409);

      // Ya tuvo subasta: no puede reactivarse
      await http()
        .patch(`/admin/listings/${listingId}/unsuspend`)
        .set(auth(users.admin.token))
        .send({})
        .expect(409);

      // Ni suspenderse dos veces
      await http()
        .patch(`/admin/listings/${listingId}/suspend`)
        .set(auth(users.admin.token))
        .send({})
        .expect(409);
    });

    it('una publicación sin subasta se suspende y vuelve a revisión al levantar la suspensión', async () => {
      const listingId = await createListing('suspend-free');

      await http()
        .patch(`/admin/listings/${listingId}/suspend`)
        .set(auth(users.admin.token))
        .send({})
        .expect(200);

      const res = await http()
        .patch(`/admin/listings/${listingId}/unsuspend`)
        .set(auth(users.admin.token))
        .send({ reason: 'Aclarado con el vendedor' })
        .expect(200);

      expect(res.body.status).toBe(ListingStatus.PENDING_REVIEW);

      const reviews = await http()
        .get('/admin/reviews')
        .set(auth(users.admin.token))
        .expect(200);

      expect(
        reviews.body.map((l: { id: number }) => l.id),
      ).toContain(listingId);

      // Una publicación que no está suspendida no se puede "levantar"
      await http()
        .patch(`/admin/listings/${listingId}/unsuspend`)
        .set(auth(users.admin.token))
        .send({})
        .expect(400);
    });

    it('no suspende una publicación finalizada', async () => {
      const { auctionId, listingId } = await createAuction('suspend-finished');

      await bid(auctionId, users.alice.token, 1050000).expect(201);
      await expire(auctionId);
      await auctionsService.closeAuction(auctionId);

      await http()
        .patch(`/admin/listings/${listingId}/suspend`)
        .set(auth(users.admin.token))
        .send({})
        .expect(409);
    });
  });

  describe('eventos en tiempo real', () => {
    it('una puja llega a los clientes que siguen la subasta', async () => {
      const { auctionId } = await createAuction('rt-bid');

      const watcher = await connect();
      const other = await connect();

      await watcher.socket.emitWithAck('auction:join', { auctionId });

      await bid(auctionId, users.alice.token, 1050000).expect(201);

      await eventually(
        () => (watcher.events['bid:new']?.length ?? 0) === 1,
        'bid:new',
      );

      expect(watcher.events['bid:new'][0]).toMatchObject({
        auctionId,
        currentPrice: 1050000,
        bid: { bidderId: users.alice.id, amount: 1050000 },
      });

      // Un cliente que no se unió no recibe nada
      expect(other.events['bid:new']).toBeUndefined();
    });

    it('una puja rechazada no genera ningún evento', async () => {
      const { auctionId } = await createAuction('rt-rejected');

      const watcher = await connect();

      await watcher.socket.emitWithAck('auction:join', { auctionId });

      await bid(auctionId, users.alice.token, 1).expect(400);
      await bid(auctionId, users.seller.token, 1050000).expect(409);

      await new Promise((r) => setTimeout(r, 300));

      expect(watcher.events['bid:new']).toBeUndefined();
    });

    it('el cierre avisa al vendedor y al ganador, y crea la orden en tiempo real', async () => {
      const { auctionId } = await createAuction('rt-close');

      const seller = await connect(users.seller.token);
      const alice = await connect(users.alice.token);
      const bob = await connect(users.bob.token);
      const feed = await connect();

      await feed.socket.emitWithAck('auctions:watch');

      await bid(auctionId, users.alice.token, 1050000).expect(201);
      await bid(auctionId, users.bob.token, 1100000).expect(201);

      await expire(auctionId);
      await auctionsService.closeAuction(auctionId);

      await eventually(
        () =>
          (seller.events['auction:result']?.length ?? 0) === 1 &&
          (bob.events['auction:result']?.length ?? 0) === 1,
        'auction:result',
      );

      expect(bob.events['auction:result'][0]).toMatchObject({
        auctionId,
        winnerId: users.bob.id,
        finalPrice: 1100000,
      });

      expect(bob.events['auction:result'][0].orderId).toEqual(
        expect.any(Number),
      );

      // Los eventos de orden llegan solo a comprador y vendedor
      await eventually(
        () =>
          (seller.events['order:created']?.length ?? 0) === 1 &&
          (bob.events['order:created']?.length ?? 0) === 1,
        'order:created',
      );

      expect(alice.events['auction:result']).toBeUndefined();
      expect(alice.events['order:created']).toBeUndefined();

      // El listado público sí ve el cambio de estado
      await eventually(
        () =>
          (feed.events['auction:status'] ?? []).some(
            (e: any) =>
              e.auctionId === auctionId &&
              e.status === AuctionStatus.FINISHED,
          ),
        'auction:status FINISHED',
      );
    });

    it('el pago de la orden se notifica a comprador y vendedor', async () => {
      const { auctionId } = await createAuction('rt-pay');

      await bid(auctionId, users.alice.token, 1050000).expect(201);
      await expire(auctionId);
      await auctionsService.closeAuction(auctionId);

      const order = await dataSource
        .getRepository(Order)
        .findOneByOrFail({ auctionId });

      const seller = await connect(users.seller.token);
      const alice = await connect(users.alice.token);
      const bob = await connect(users.bob.token);

      await http()
        .post(`/orders/${order.id}/payment`)
        .set(auth(users.alice.token))
        .send({ result: 'APPROVED' })
        .expect(201);

      await eventually(
        () =>
          (seller.events['order:updated']?.length ?? 0) === 1 &&
          (alice.events['order:updated']?.length ?? 0) === 1,
        'order:updated',
      );

      expect(alice.events['order:updated'][0]).toMatchObject({
        orderId: order.id,
        status: 'PAID',
      });
      expect(bob.events['order:updated']).toBeUndefined();
    });

    it('la cancelación por el administrador se notifica a quienes siguen la subasta', async () => {
      const { auctionId } = await createAuction('rt-admin-cancel');

      const watcher = await connect();

      await watcher.socket.emitWithAck('auction:join', { auctionId });

      await http()
        .patch(`/admin/auctions/${auctionId}/cancel`)
        .set(auth(users.admin.token))
        .send({ reason: 'Fraude' })
        .expect(200);

      await eventually(
        () =>
          (watcher.events['auction:status'] ?? []).some(
            (e: any) => e.status === AuctionStatus.CANCELLED,
          ),
        'auction:status CANCELLED',
      );

      const event = watcher.events['auction:status'].find(
        (e: any) => e.status === AuctionStatus.CANCELLED,
      );

      expect(event.cancelReason).toBe('Fraude');
    });

    it('un token inválido es desconectado con auth:error', async () => {
      const socket = io(baseUrl, {
        auth: { token: 'no-es-un-jwt' },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });

      sockets.push(socket);

      const error = await new Promise<any>((resolve) =>
        socket.once('auth:error', resolve),
      );

      expect(error.message).toBeDefined();
    });
  });
});
