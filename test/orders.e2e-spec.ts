import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/common/setup-app';
import { AiService } from '../src/listings/ai/ai.service';
import { Auction } from '../src/auctions/entities/auction.entity';
import { AuctionStatus } from '../src/auctions/enums/auction-status.enum';
import { Order } from '../src/orders/entities/order.entity';
import { OrdersService } from '../src/orders/orders.service';

/**
 * Flujo de órdenes (pago y entrega). Aquí la subasta se deja FINISHED con
 * ganador directamente en BD para aislar las reglas de Orders; el cierre
 * real (ofertas -> ganador -> orden) se prueba en auction-flow.e2e-spec.ts.
 */
describe('Orders E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ordersService: OrdersService;

  const timestamp = Date.now();
  const password = 'Test12345';

  const users = {
    seller: { email: `orders-seller-${timestamp}@test.com`, token: '', id: 0 },
    buyer: { email: `orders-buyer-${timestamp}@test.com`, token: '', id: 0 },
    stranger: { email: `orders-stranger-${timestamp}@test.com`, token: '', id: 0 },
  };

  const aiServiceMock = {
    validateListing: jest.fn().mockResolvedValue({
      decision: 'APPROVE',
      reason: 'Producto válido',
      confidence: 0.95,
    }),
  };

  const auth = (token: string) => ({
    Authorization: `Bearer ${token}`,
  });

  async function createFinishedAuction(
    label: string,
  ): Promise<number> {
    const listing = await request(app.getHttpServer())
      .post('/listings')
      .set(auth(users.seller.token))
      .send({
        title: `Producto Orders ${label} ${timestamp}`,
        description:
          'Producto creado para probar el flujo de órdenes.',
        category: 'Tecnología',
        initialPrice: 1000000,
        minimumIncrement: 50000,
        durationHours: 12,
      })
      .expect(201);

    const now = Date.now();

    const auction = await request(app.getHttpServer())
      .post('/auctions')
      .set(auth(users.seller.token))
      .send({
        listingId: listing.body.id,
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 6 * 3600_000).toISOString(),
      })
      .expect(201);

    await dataSource.getRepository(Auction).update(
      { id: auction.body.id },
      {
        status: AuctionStatus.FINISHED,
        winnerId: users.buyer.id,
        currentPrice: 1050000,
      },
    );

    return auction.body.id;
  }

  async function createOrder(label: string) {
    const auctionId = await createFinishedAuction(label);
    const { order } =
      await ordersService.createForAuction(auctionId);
    return order;
  }

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
    await app.init();

    dataSource = app.get(DataSource);
    ordersService = app.get(OrdersService);

    for (const key of Object.keys(users) as (keyof typeof users)[]) {
      const user = users[key];

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: `Orders ${key}`, email: user.email, password })
        .expect(201);

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password })
        .expect(201);

      user.token = login.body.access_token;

      const me = await request(app.getHttpServer())
        .get('/users/me')
        .set(auth(user.token))
        .expect(200);

      user.id = me.body.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza el acceso sin JWT', async () => {
    await request(app.getHttpServer()).get('/orders').expect(401);
    await request(app.getHttpServer())
      .post('/orders/1/payment')
      .send({ result: 'APPROVED' })
      .expect(401);
  });

  describe('creación de la orden (cierre)', () => {
    it('crea una única orden aunque se invoque varias veces en paralelo', async () => {
      const auctionId = await createFinishedAuction('idem');

      const results = await Promise.all([
        ordersService.createForAuction(auctionId),
        ordersService.createForAuction(auctionId),
        ordersService.createForAuction(auctionId),
      ]);

      expect(results.filter((r) => r.created)).toHaveLength(1);

      const orders = await dataSource
        .getRepository(Order)
        .find({ where: { auctionId } });

      expect(orders).toHaveLength(1);
      expect(orders[0].buyerId).toBe(users.buyer.id);
      expect(orders[0].sellerId).toBe(users.seller.id);
      expect(orders[0].amount).toBe(1050000);
      expect(orders[0].status).toBe('PENDING_PAYMENT');
    });
  });

  describe('consulta y permisos', () => {
    let orderId: number;

    beforeAll(async () => {
      orderId = (await createOrder('read')).id;
    });

    it('comprador y vendedor ven la orden en su listado', async () => {
      for (const user of [users.buyer, users.seller]) {
        const res = await request(app.getHttpServer())
          .get('/orders')
          .set(auth(user.token))
          .expect(200);

        expect(res.body.some((o: any) => o.id === orderId)).toBe(true);
      }
    });

    it('un usuario ajeno no la ve en su listado ni puede abrirla', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders')
        .set(auth(users.stranger.token))
        .expect(200);

      expect(res.body.some((o: any) => o.id === orderId)).toBe(false);

      await request(app.getHttpServer())
        .get(`/orders/${orderId}`)
        .set(auth(users.stranger.token))
        .expect(403);
    });

    it('devuelve 404 para una orden inexistente', async () => {
      await request(app.getHttpServer())
        .get('/orders/99999999')
        .set(auth(users.buyer.token))
        .expect(404);
    });
  });

  describe('pago simulado', () => {
    let orderId: number;

    beforeAll(async () => {
      orderId = (await createOrder('pay')).id;
    });

    it('rechaza un body inválido', async () => {
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/payment`)
        .set(auth(users.buyer.token))
        .send({ result: 'MAYBE' })
        .expect(400);
    });

    it('el vendedor y un ajeno no pueden pagar', async () => {
      for (const user of [users.seller, users.stranger]) {
        await request(app.getHttpServer())
          .post(`/orders/${orderId}/payment`)
          .set(auth(user.token))
          .send({ result: 'APPROVED' })
          .expect(403);
      }
    });

    it('un pago rechazado deja la orden reintentable', async () => {
      const res = await request(app.getHttpServer())
        .post(`/orders/${orderId}/payment`)
        .set(auth(users.buyer.token))
        .send({ result: 'REJECTED' })
        .expect(201);

      expect(res.body.status).toBe('PAYMENT_REJECTED');
    });

    it('un pago aprobado marca la orden como PAID', async () => {
      const res = await request(app.getHttpServer())
        .post(`/orders/${orderId}/payment`)
        .set(auth(users.buyer.token))
        .send({ result: 'APPROVED' })
        .expect(201);

      expect(res.body.status).toBe('PAID');
      expect(res.body.paymentAttempts).toBe(2);
      expect(res.body.paymentReference).toMatch(/^SIM-/);
    });

    it('no admite pagar dos veces', async () => {
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/payment`)
        .set(auth(users.buyer.token))
        .send({ result: 'APPROVED' })
        .expect(409);
    });
  });

  describe('entrega', () => {
    it('no se puede entregar una orden sin pago', async () => {
      const order = await createOrder('nopay');

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/delivery`)
        .set(auth(users.seller.token))
        .send({ status: 'DELIVERED' })
        .expect(409);
    });

    it('flujo completo: pago aprobado y entrega por el vendedor', async () => {
      const order = await createOrder('deliver');

      await request(app.getHttpServer())
        .post(`/orders/${order.id}/payment`)
        .set(auth(users.buyer.token))
        .send({ result: 'APPROVED' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/delivery`)
        .set(auth(users.buyer.token))
        .send({ status: 'DELIVERED' })
        .expect(403);

      const res = await request(app.getHttpServer())
        .patch(`/orders/${order.id}/delivery`)
        .set(auth(users.seller.token))
        .send({ status: 'DELIVERED', notes: 'Entregado' })
        .expect(200);

      expect(res.body.status).toBe('DELIVERED');
      expect(res.body.deliveredAt).toBeTruthy();

      // Estado terminal
      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/delivery`)
        .set(auth(users.seller.token))
        .send({ status: 'CANCELLED' })
        .expect(409);
    });

    it('el vendedor puede registrar incumplimiento de pago', async () => {
      const order = await createOrder('default');

      const res = await request(app.getHttpServer())
        .patch(`/orders/${order.id}/delivery`)
        .set(auth(users.seller.token))
        .send({ status: 'DEFAULTED' })
        .expect(200);

      expect(res.body.status).toBe('DEFAULTED');
    });

    it('el comprador puede cancelar antes de pagar', async () => {
      const order = await createOrder('cancel');

      const res = await request(app.getHttpServer())
        .patch(`/orders/${order.id}/delivery`)
        .set(auth(users.buyer.token))
        .send({ status: 'CANCELLED' })
        .expect(200);

      expect(res.body.status).toBe('CANCELLED');
    });

    it('rechaza una acción de entrega inválida', async () => {
      const order = await createOrder('invalid');

      await request(app.getHttpServer())
        .patch(`/orders/${order.id}/delivery`)
        .set(auth(users.seller.token))
        .send({ status: 'PAID' })
        .expect(400);
    });
  });
});
