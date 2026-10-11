import {
  INestApplication,
} from '@nestjs/common';
import {
  Test,
  TestingModule,
} from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/common/setup-app';
import { AiService } from '../src/listings/ai/ai.service';
import { AuctionStatus } from '../src/auctions/enums/auction-status.enum';

describe('Bids E2E', () => {
  let app: INestApplication;

  let sellerToken: string;
  let bidderToken: string;
  let auctionId: number;

  const timestamp = Date.now();

  const sellerEmail =
    `auction-seller-${timestamp}@test.com`;

  const bidderEmail =
    `auction-bidder-${timestamp}@test.com`;

  const password = 'Test12345';

  const aiServiceMock = {
    validateListing: jest.fn().mockResolvedValue({
      decision: 'APPROVE',
      reason: 'Producto válido',
      confidence: 0.95,
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(AiService)
        .useValue(aiServiceMock)
        .compile();

    app =
      moduleFixture.createNestApplication();

    setupApp(app);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('debería registrar al vendedor', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .post('/auth/register')
      .send({
        name: 'Auction Seller',
        email: sellerEmail,
        password,
      })
      .expect(201);

    expect(response.body.email).toBe(
      sellerEmail,
    );
  });

  it('debería registrar al comprador', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .post('/auth/register')
      .send({
        name: 'Auction Bidder',
        email: bidderEmail,
        password,
      })
      .expect(201);

    expect(response.body.email).toBe(
      bidderEmail,
    );
  });

  it('debería iniciar sesión como vendedor', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .post('/auth/login')
      .send({
        email: sellerEmail,
        password,
      })
      .expect(201);

    sellerToken =
      response.body.access_token;

    expect(sellerToken).toBeDefined();
  });

  it('debería iniciar sesión como comprador', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .post('/auth/login')
      .send({
        email: bidderEmail,
        password,
      })
      .expect(201);

    bidderToken =
      response.body.access_token;

    expect(bidderToken).toBeDefined();
  });

  it('debería crear una publicación aprobada', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .post('/listings')
      .set(
        'Authorization',
        `Bearer ${sellerToken}`,
      )
      .send({
        title: `Producto Auction ${timestamp}`,
        description:
          'Producto creado para probar el flujo completo de subastas.',
        category: 'Tecnología',
        initialPrice: 1000000,
        minimumIncrement: 50000,
        durationHours: 12,
      })
      .expect(201);

    expect(response.body.status).toBe(
      'APPROVED',
    );
  });

  it('debería crear una subasta activa', async () => {
    const listingResponse =
      await request(
        app.getHttpServer(),
      )
        .get('/listings/mine')
        .set(
          'Authorization',
          `Bearer ${sellerToken}`,
        )
        .expect(200);

    const listing =
      listingResponse.body.find(
        (item: any) =>
          item.title ===
          `Producto Auction ${timestamp}`,
      );

    expect(listing).toBeDefined();

    const now = new Date();

    const startsAt = new Date(
      now.getTime() - 60 * 1000,
    );

    const endsAt = new Date(
      now.getTime() + 6 * 60 * 60 * 1000,
    );

    const response = await request(
      app.getHttpServer(),
    )
      .post('/auctions')
      .set(
        'Authorization',
        `Bearer ${sellerToken}`,
      )
      .send({
        listingId: listing.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      })
      .expect(201);

    expect(response.body.status).toBe(
      AuctionStatus.ACTIVE,
    );

    auctionId = response.body.id;
  });

  it('debería rechazar una oferta sin autenticación', async () => {
    await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .send({
        amount: 1050000,
      })
      .expect(401);
  });

  it('debería impedir al vendedor ofertar en su propia subasta', async () => {
    await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set(
        'Authorization',
        `Bearer ${sellerToken}`,
      )
      .send({
        amount: 1050000,
      })
      .expect(409);
  });

  it('debería rechazar una oferta inferior al incremento mínimo', async () => {
    await request(app.getHttpServer())
      .post(`/auctions/${auctionId}/bids`)
      .set(
        'Authorization',
        `Bearer ${bidderToken}`,
      )
      .send({
        amount: 1049999,
      })
      .expect(400);
  });

  it('debería aceptar una oferta válida', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .post(`/auctions/${auctionId}/bids`)
      .set(
        'Authorization',
        `Bearer ${bidderToken}`,
      )
      .send({
        amount: 1050000,
      })
      .expect(201);

    expect(response.body).toHaveProperty(
      'id',
    );

    expect(response.body.amount).toBe(
      '1050000.00',
    );

    expect(response.body.auctionId).toBe(
      auctionId,
    );

    expect(response.body.bidderId).toBeDefined();
  });

  it('debería actualizar el precio actual de la subasta', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .get(`/auctions/${auctionId}`)
      .expect(200);

    expect(Number(response.body.currentPrice)).toBe(
      1050000,
    );
  });

  it('debería obtener las ofertas de la subasta', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .get(`/auctions/${auctionId}/bids`)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(
      true,
    );

    expect(
      response.body.some(
        (bid: any) =>
          Number(bid.amount) === 1050000,
      ),
    ).toBe(true);
  });

  it('debería obtener mis ofertas', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .get('/auctions/my-bids')
      .set(
        'Authorization',
        `Bearer ${bidderToken}`,
      )
      .expect(200);

    expect(Array.isArray(response.body)).toBe(
      true,
    );

    expect(
      response.body.some(
        (bid: any) =>
          Number(bid.amount) === 1050000,
      ),
    ).toBe(true);
  });
});