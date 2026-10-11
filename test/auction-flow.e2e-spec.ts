import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/common/setup-app';
import { AiService } from '../src/listings/ai/ai.service';
import { AuctionsService } from '../src/auctions/auctions.service';
import { Auction } from '../src/auctions/entities/auction.entity';
import { AuctionStatus } from '../src/auctions/enums/auction-status.enum';
import { Listing } from '../src/listings/entities/listing.entity';
import { ListingStatus } from '../src/listings/enums/listing-status.enum';
import { Order } from '../src/orders/entities/order.entity';
import { OrderStatus } from '../src/orders/enums/order-status.enum';

/**
 * Flujo completo: publicación -> subasta -> ofertas -> cierre -> orden.
 * El temporizador no corre en NODE_ENV=test, por eso el cierre se
 * dispara llamando a AuctionsService directamente.
 */
describe('Auction flow E2E (bids + cierre + orders)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let auctionsService: AuctionsService;
  let baseUrl: string;

  const timestamp = Date.now();
  const password = 'Test12345';
  const HOUR = 3_600_000;

  const users = {
    seller: { email: `flow-seller-${timestamp}@test.com`, token: '', id: 0 },
    alice: { email: `flow-alice-${timestamp}@test.com`, token: '', id: 0 },
    bob: { email: `flow-bob-${timestamp}@test.com`, token: '', id: 0 },
  };

  const aiServiceMock = {
    validateListing: jest.fn().mockResolvedValue({
      decision: 'APPROVE',
      risk: 'LOW',
      reason: 'Producto válido',
      confidence: 0.95,
    }),
  };

  const auth = (token: string) => ({
    Authorization: `Bearer ${token}`,
  });

  async function createAuction(
    label: string,
    startsAt = new Date(Date.now() - 60_000),
    endsAt = new Date(Date.now() + 6 * HOUR),
  ) {
    const listing = await request(app.getHttpServer())
      .post('/listings')
      .set(auth(users.seller.token))
      .send({
        title: `Producto Flow ${label} ${timestamp}`,
        description:
          'Producto creado para probar el flujo completo de subasta.',
        category: 'Tecnología',
        initialPrice: 1000000,
        minimumIncrement: 50000,
        durationHours: 12,
      })
      .expect(201);

    const auction = await request(app.getHttpServer())
      .post('/auctions')
      .set(auth(users.seller.token))
      .send({
        listingId: listing.body.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      })
      .expect(201);

    return {
      auctionId: auction.body.id as number,
      listingId: listing.body.id as number,
      status: auction.body.status as AuctionStatus,
    };
  }

  const bid = (
    auctionId: number,
    token: string,
    amount: number,
  ) =>
    request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set(auth(token))
      .send({ amount });

  /** Hace vencer la subasta sin esperar horas. */
  const expire = (auctionId: number) =>
    dataSource.getRepository(Auction).update(
      { id: auctionId },
      { endsAt: new Date(Date.now() - 1000) },
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule =
      await Test.createTestingModule({
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

    for (const key of Object.keys(users) as (keyof typeof users)[]) {
      const user = users[key];

      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: `Flow ${key}`, email: user.email, password })
        .expect(201);

      user.id = registered.body.id;

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password })
        .expect(201);

      user.token = login.body.access_token;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ciclo de vida de la publicación', () => {
    it('la publicación pasa a ACTIVE al crear una subasta que ya inició', async () => {
      const { listingId, status } = await createAuction('lifecycle');

      expect(status).toBe(AuctionStatus.ACTIVE);

      const listing = await dataSource
        .getRepository(Listing)
        .findOneByOrFail({ id: listingId });

      expect(listing.status).toBe(ListingStatus.ACTIVE);
    });

    it('una subasta programada se activa cuando llega su hora de inicio', async () => {
      const { auctionId, listingId, status } = await createAuction(
        'scheduled',
        new Date(Date.now() + HOUR),
        new Date(Date.now() + 4 * HOUR),
      );

      expect(status).toBe(AuctionStatus.SCHEDULED);

      await bid(auctionId, users.alice.token, 1050000).expect(400);

      await dataSource
        .getRepository(Auction)
        .update({ id: auctionId }, { startsAt: new Date(Date.now() - 1000) });

      await auctionsService.activateDueAuctions();

      const auction = await dataSource
        .getRepository(Auction)
        .findOneByOrFail({ id: auctionId });
      const listing = await dataSource
        .getRepository(Listing)
        .findOneByOrFail({ id: listingId });

      expect(auction.status).toBe(AuctionStatus.ACTIVE);
      expect(listing.status).toBe(ListingStatus.ACTIVE);
    });

    it('la subasta aparece en /auctions/active', async () => {
      const { auctionId } = await createAuction('active-list');

      const response = await request(app.getHttpServer())
        .get('/auctions/active')
        .expect(200);

      expect(
        response.body.map((a: { id: number }) => a.id),
      ).toContain(auctionId);
    });
  });

  describe('ofertas y cierre con ganador', () => {
    let auctionId: number;
    let listingId: number;

    beforeAll(async () => {
      ({ auctionId, listingId } = await createAuction('winner'));
    });

    it('acepta ofertas crecientes de distintos usuarios', async () => {
      await bid(auctionId, users.alice.token, 1050000).expect(201);
      await bid(auctionId, users.bob.token, 1100000).expect(201);
    });

    it('rechaza una oferta que no supera el precio actual más el incremento', async () => {
      await bid(auctionId, users.alice.token, 1100000).expect(400);
    });

    it('no deja que el mejor postor se supere a sí mismo', async () => {
      await bid(auctionId, users.bob.token, 1200000).expect(409);
    });

    it('rechaza ofertas con más de 2 decimales o montos inválidos', async () => {
      await bid(auctionId, users.alice.token, 1200000.123).expect(400);
      await bid(auctionId, users.alice.token, -5).expect(400);
    });

    it('no permite cancelar una subasta con ofertas', async () => {
      await request(app.getHttpServer())
        .patch(`/auctions/${auctionId}/cancel`)
        .set(auth(users.seller.token))
        .expect(409);
    });

    it('un id inválido responde 400', async () => {
      await request(app.getHttpServer())
        .get('/auctions/abc/bids')
        .expect(400);
      await request(app.getHttpServer())
        .get('/auctions/0')
        .expect(400);
    });

    it('una subasta inexistente responde 404', async () => {
      await request(app.getHttpServer())
        .get('/auctions/999999/bids')
        .expect(404);
    });

    it('no cierra una subasta que aún no vence', async () => {
      expect(await auctionsService.closeAuction(auctionId)).toBeNull();
    });

    it('al vencer define ganador, finaliza la publicación y crea la orden', async () => {
      await expire(auctionId);

      expect(await auctionsService.closeDueAuctions()).toBeGreaterThanOrEqual(1);

      const auction = await dataSource
        .getRepository(Auction)
        .findOneByOrFail({ id: auctionId });

      expect(auction.status).toBe(AuctionStatus.FINISHED);
      expect(auction.winnerId).toBe(users.bob.id);
      expect(Number(auction.currentPrice)).toBe(1100000);

      const listing = await dataSource
        .getRepository(Listing)
        .findOneByOrFail({ id: listingId });

      expect(listing.status).toBe(ListingStatus.FINISHED);

      const order = await dataSource
        .getRepository(Order)
        .findOneByOrFail({ auctionId });

      expect(order).toMatchObject({
        buyerId: users.bob.id,
        sellerId: users.seller.id,
        status: OrderStatus.PENDING_PAYMENT,
      });
      expect(Number(order.amount)).toBe(1100000);
    });

    it('cerrar de nuevo no duplica la orden (idempotente)', async () => {
      expect(await auctionsService.closeAuction(auctionId)).toBeNull();

      const count = await dataSource
        .getRepository(Order)
        .countBy({ auctionId });

      expect(count).toBe(1);
    });

    it('el ganador y el vendedor ven la orden; otro usuario no', async () => {
      const order = await dataSource
        .getRepository(Order)
        .findOneByOrFail({ auctionId });

      await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set(auth(users.bob.token))
        .expect(200);

      await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set(auth(users.seller.token))
        .expect(200);

      await request(app.getHttpServer())
        .get(`/orders/${order.id}`)
        .set(auth(users.alice.token))
        .expect(403);
    });

    it('el ganador puede pagar la orden generada por el cierre', async () => {
      const order = await dataSource
        .getRepository(Order)
        .findOneByOrFail({ auctionId });

      const response = await request(app.getHttpServer())
        .post(`/orders/${order.id}/payment`)
        .set(auth(users.bob.token))
        .send({ result: 'APPROVED' })
        .expect(201);

      expect(response.body.status).toBe(OrderStatus.PAID);
    });

    it('rechaza ofertas sobre una subasta finalizada', async () => {
      await bid(auctionId, users.alice.token, 2000000).expect(400);
    });
  });

  describe('subasta sin ofertas', () => {
    it('termina sin ganador y sin orden', async () => {
      const { auctionId, listingId } = await createAuction('no-bids');

      await expire(auctionId);
      await auctionsService.closeDueAuctions();

      const auction = await dataSource
        .getRepository(Auction)
        .findOneByOrFail({ id: auctionId });

      expect(auction.status).toBe(AuctionStatus.FINISHED);
      expect(auction.winnerId).toBeNull();

      expect(
        await dataSource.getRepository(Order).countBy({ auctionId }),
      ).toBe(0);

      const listing = await dataSource
        .getRepository(Listing)
        .findOneByOrFail({ id: listingId });

      expect(listing.status).toBe(ListingStatus.FINISHED);
    });
  });

  describe('cancelación', () => {
    it('el vendedor cancela una subasta sin ofertas y la publicación queda CANCELLED', async () => {
      const { auctionId, listingId } = await createAuction('cancel');

      await request(app.getHttpServer())
        .patch(`/auctions/${auctionId}/cancel`)
        .set(auth(users.alice.token))
        .expect(403);

      const response = await request(app.getHttpServer())
        .patch(`/auctions/${auctionId}/cancel`)
        .set(auth(users.seller.token))
        .expect(200);

      expect(response.body.status).toBe(AuctionStatus.CANCELLED);

      const listing = await dataSource
        .getRepository(Listing)
        .findOneByOrFail({ id: listingId });

      expect(listing.status).toBe(ListingStatus.CANCELLED);

      await bid(auctionId, users.alice.token, 1050000).expect(400);
    });
  });

  describe('concurrencia', () => {
    it('dos ofertas simultáneas por el mismo monto: solo una gana', async () => {
      const { auctionId } = await createAuction('race');

      const send = (token: string) =>
        fetch(`${baseUrl}/auctions/${auctionId}/bids`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...auth(token),
          },
          body: JSON.stringify({ amount: 1050000 }),
        }).then((r) => r.status);

      const statuses = await Promise.all([
        send(users.alice.token),
        send(users.bob.token),
      ]);

      expect(statuses.sort()).toEqual([201, 400]);

      const auction = await dataSource
        .getRepository(Auction)
        .findOneByOrFail({ id: auctionId });

      expect(Number(auction.currentPrice)).toBe(1050000);
    });
  });
});
