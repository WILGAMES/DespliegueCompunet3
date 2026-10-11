import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/common/setup-app';
import { SeedService } from '../src/seed/seed.service';
import { DEMO_LISTINGS, DEMO_USERS } from '../src/seed/demo-data';
import { Listing } from '../src/listings/entities/listing.entity';
import { ListingStatus } from '../src/listings/enums/listing-status.enum';
import { Order } from '../src/orders/entities/order.entity';
import { User } from '../src/users/entities/user.entity';

describe('Seed E2E (datos de demostración)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let seedService: SeedService;

  beforeAll(async () => {
    const moduleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    seedService = app.get(SeedService);

    // En NODE_ENV=test el seed demo no corre solo; se invoca aquí
    await seedService.seedDemoData();
  });

  afterAll(async () => {
    await app.close();
  });

  it('es idempotente: una segunda ejecución no duplica datos', async () => {
    const before = await dataSource.getRepository(User).count();

    expect(await seedService.seedDemoData()).toBe(false);
    expect(await dataSource.getRepository(User).count()).toBe(before);
  });

  it('crea los usuarios demo con contraseña conocida', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: DEMO_USERS[0].email, password: 'Demo12345' })
      .expect(201);

    expect(login.body).toHaveProperty('access_token');
  });

  it('el usuario inactivo no puede iniciar sesión', async () => {
    const inactive = DEMO_USERS.find((u) => !u.isActive)!;

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: inactive.email, password: 'Demo12345' })
      .expect((res) => {
        expect([401, 403]).toContain(res.status);
      });
  });

  it('crea todas las publicaciones demo en sus estados', async () => {
    // Los estados ligados al tiempo (programada/activa) avanzan solos
    // si el cierre automático corrió; para ellos se acepta el ciclo completo.
    const timeBound = [
      ListingStatus.SCHEDULED,
      ListingStatus.ACTIVE,
    ];
    const lifecycle = [
      ListingStatus.SCHEDULED,
      ListingStatus.ACTIVE,
      ListingStatus.FINISHED,
    ];

    for (const demo of DEMO_LISTINGS) {
      const listing = await dataSource
        .getRepository(Listing)
        .findOneByOrFail({ title: demo.title });

      if (timeBound.includes(demo.status)) {
        expect(lifecycle).toContain(listing.status);
      } else {
        expect(listing.status).toBe(demo.status);
      }
    }
  });

  it('las subastas activas demo se pueden consultar y ofertar', async () => {
    const active = await request(app.getHttpServer())
      .get('/auctions/active')
      .expect(200);

    expect(active.body.length).toBeGreaterThanOrEqual(1);

    // Usuario nuevo en cada ejecución: la suite puede repetirse sobre la misma BD
    const email = `seed-bidder-${Date.now()}@test.com`;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Seed Bidder', email, password: 'Test12345' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'Test12345' })
      .expect(201);

    const silla = await dataSource
      .getRepository(Listing)
      .findOneOrFail({
        where: { title: 'Silla gamer ergonómica' },
        relations: { auction: true },
      });

    const amount =
      Number(silla.auction!.currentPrice) +
      Number(silla.auction!.minimumIncrement);

    await request(app.getHttpServer())
      .post(`/auctions/${silla.auction!.id}/bids`)
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .send({ amount })
      .expect(201);
  });

  it('las órdenes demo cubren distintos estados', async () => {
    // Otras suites (o Postman) pueden haber avanzado algunas órdenes,
    // por eso solo se exige variedad y no estados concretos.
    const statuses = (
      await dataSource.getRepository(Order).find()
    ).map((o) => o.status);

    expect(statuses.length).toBeGreaterThanOrEqual(4);
    expect(new Set(statuses).size).toBeGreaterThanOrEqual(3);
  });
});
