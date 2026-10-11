import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { setupApp } from '../src/common/setup-app';
import { AiService } from '../src/listings/ai/ai.service';

describe('Listings E2E', () => {
  let app: INestApplication;

  let userToken: string;
  let adminToken: string;
  let listingId: number;

  const userEmail = `seller${Date.now()}@test.com`;
  const userPassword = 'Test12345';

  const aiServiceMock = {
    validateListing: jest.fn().mockResolvedValue({
      decision: 'APPROVE',
      risk: 'LOW',
      reason: 'Producto válido para subasta',
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

    app = moduleFixture.createNestApplication();

    setupApp(app);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('debería registrar un usuario', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Seller E2E',
        email: userEmail,
        password: userPassword,
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.email).toBe(userEmail);
    expect(response.body).not.toHaveProperty('password');
  });

  it('debería iniciar sesión como usuario', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: userEmail,
        password: userPassword,
      })
      .expect(201);

    expect(response.body).toHaveProperty(
      'access_token',
    );

    userToken = response.body.access_token;
  });

  it('debería rechazar crear una publicación sin autenticación', async () => {
    await request(app.getHttpServer())
      .post('/listings')
      .send({
        title: 'Laptop Lenovo',
        description:
          'Laptop Lenovo en buen estado para trabajo.',
        category: 'Tecnología',
        initialPrice: 1500000,
        minimumIncrement: 50000,
        durationHours: 12,
      })
      .expect(401);
  });

  it('debería crear una publicación autenticada', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .post('/listings')
      .set(
        'Authorization',
        `Bearer ${userToken}`,
      )
      .send({
        title: 'Laptop Lenovo E2E',
        description:
          'Laptop Lenovo en buen estado para trabajo y estudio.',
        category: 'Tecnología',
        initialPrice: 1500000,
        minimumIncrement: 50000,
        durationHours: 12,
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.title).toBe(
      'Laptop Lenovo E2E',
    );
    expect(response.body.sellerId).toBeDefined();

    expect(response.body.status).toBe('APPROVED');

    listingId = response.body.id;
  });

  it('debería obtener todas las publicaciones', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .get('/listings')
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);

    expect(
      response.body.some(
        (listing: any) =>
          listing.id === listingId,
      ),
    ).toBe(true);
  });

  it('debería obtener las publicaciones propias', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .get('/listings/mine')
      .set(
        'Authorization',
        `Bearer ${userToken}`,
      )
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);

    expect(
      response.body.some(
        (listing: any) =>
          listing.id === listingId,
      ),
    ).toBe(true);
  });

  it('debería obtener una publicación específica', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .get(`/listings/${listingId}`)
      .expect(200);

    expect(response.body.id).toBe(listingId);
    expect(response.body.title).toBe(
      'Laptop Lenovo E2E',
    );
  });

  it('debería actualizar una publicación propia', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .patch(`/listings/${listingId}`)
      .set(
        'Authorization',
        `Bearer ${userToken}`,
      )
      .send({
        title: 'Laptop Lenovo E2E Actualizada',
      })
      .expect(200);

    expect(response.body.title).toBe(
      'Laptop Lenovo E2E Actualizada',
    );
  });

  it('debería impedir que otro usuario modifique la publicación', async () => {
    const anotherEmail = `another${Date.now()}@test.com`;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Another User',
        email: anotherEmail,
        password: userPassword,
      })
      .expect(201);

    const loginResponse = await request(
      app.getHttpServer(),
    )
      .post('/auth/login')
      .send({
        email: anotherEmail,
        password: userPassword,
      })
      .expect(201);

    const anotherToken =
      loginResponse.body.access_token;

    await request(app.getHttpServer())
      .patch(`/listings/${listingId}`)
      .set(
        'Authorization',
        `Bearer ${anotherToken}`,
      )
      .send({
        title: 'Intento de modificación',
      })
      .expect(409);
  });

  it('debería iniciar sesión como administrador', async () => {
    const response = await request(
      app.getHttpServer(),
    )
      .post('/auth/login')
      .send({
        email: 'admin@colsubastas.com',
        password: 'Admin12345',
      })
      .expect(201);

    expect(response.body).toHaveProperty(
      'access_token',
    );

    adminToken = response.body.access_token;
  });

  it('debería permitir al administrador aprobar una publicación pendiente', async () => {
    aiServiceMock.validateListing.mockResolvedValueOnce(
      {
        decision: 'REVIEW',
        risk: 'MEDIUM',
        reason: 'Requiere revisión administrativa',
        confidence: 0.5,
      },
    );

    const pendingResponse = await request(
      app.getHttpServer(),
    )
      .post('/listings')
      .set(
        'Authorization',
        `Bearer ${userToken}`,
      )
      .send({
        title: 'Producto para revisión E2E',
        description:
          'Producto que requiere una revisión administrativa.',
        category: 'Otros',
        initialPrice: 100000,
        minimumIncrement: 10000,
        durationHours: 6,
      })
      .expect(201);

    const pendingId = pendingResponse.body.id;

    expect(pendingResponse.body.status).toBe(
      'PENDING_REVIEW',
    );

    const response = await request(
      app.getHttpServer(),
    )
      .patch(`/admin/listings/${pendingId}/approve`)
      .set(
        'Authorization',
        `Bearer ${adminToken}`,
      )
      .expect(200);

    expect(response.body.status).toBe(
      'APPROVED',
    );
    expect(response.body.reviewedById).toEqual(
      expect.any(Number),
    );
    expect(response.body.aiDecision).toBe('REVIEW');
  });

  it('debería listar la cola de revisión solo al administrador', async () => {
    aiServiceMock.validateListing.mockResolvedValueOnce(
      {
        decision: 'REVIEW',
        risk: 'MEDIUM',
        reason: 'Información insuficiente',
        confidence: 0.4,
      },
    );

    const created = await request(
      app.getHttpServer(),
    )
      .post('/listings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        title: 'Producto en cola de revisión',
        description:
          'Producto que debe aparecer en la cola de revisión.',
        category: 'Otros',
        initialPrice: 100000,
        minimumIncrement: 10000,
        durationHours: 6,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/admin/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    const queue = await request(
      app.getHttpServer(),
    )
      .get('/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(
      queue.body.map((l: { id: number }) => l.id),
    ).toContain(created.body.id);

    // Rechazo: guarda el motivo del admin sin tocar el de la IA
    const rejected = await request(
      app.getHttpServer(),
    )
      .patch(
        `/admin/listings/${created.body.id}/reject`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'No cumple las políticas' })
      .expect(200);

    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.reviewReason).toBe(
      'No cumple las políticas',
    );
    expect(rejected.body.aiReason).toBe(
      'Información insuficiente',
    );
  });

  it('debería rechazar una categoría prohibida sin consultar a la IA', async () => {
    aiServiceMock.validateListing.mockClear();

    const response = await request(
      app.getHttpServer(),
    )
      .post('/listings')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        title: 'Rifle de colección',
        description:
          'Rifle de colección en excelente estado.',
        category: 'Armas',
        initialPrice: 100000,
        minimumIncrement: 10000,
        durationHours: 6,
      })
      .expect(201);

    expect(response.body.status).toBe('REJECTED');
    expect(response.body.aiDecision).toBe('REJECT');
    expect(
      aiServiceMock.validateListing,
    ).not.toHaveBeenCalled();
  });

  it('debería rechazar acceso administrativo a un usuario normal', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/listings/${listingId}/approve`)
      .set(
        'Authorization',
        `Bearer ${userToken}`,
      )
      .expect(403);
  });

  it('debería eliminar una publicación propia', async () => {
    const createResponse = await request(
      app.getHttpServer(),
    )
      .post('/listings')
      .set(
        'Authorization',
        `Bearer ${userToken}`,
      )
      .send({
        title: 'Publicación para eliminar',
        description:
          'Esta publicación será eliminada durante la prueba.',
        category: 'Otros',
        initialPrice: 50000,
        minimumIncrement: 5000,
        durationHours: 2,
      })
      .expect(201);

    const idToDelete =
      createResponse.body.id;

    await request(app.getHttpServer())
      .delete(`/listings/${idToDelete}`)
      .set(
        'Authorization',
        `Bearer ${userToken}`,
      )
      .expect(200);

    await request(app.getHttpServer())
      .get(`/listings/${idToDelete}`)
      .expect(404);
  });
});