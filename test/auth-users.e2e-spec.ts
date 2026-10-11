import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('Auth + Users (e2e)', () => {
  let app: INestApplication;

  let userToken: string;
  let adminToken: string;
  let createdUserId: number;

  const testEmail = `felipe.${Date.now()}@test.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('debe registrar un usuario', async () => {
      const response =
        await request(app.getHttpServer())
          .post('/auth/register')
          .send({
            name: 'Felipe Test',
            email: testEmail,
            password: 'Password123',
          })
          .expect(201);

      expect(response.body).toHaveProperty(
        'id',
      );

      expect(response.body).toHaveProperty(
        'email',
        testEmail,
      );

      expect(response.body).not.toHaveProperty(
        'password',
      );

      createdUserId = response.body.id;
    });
  });

  describe('POST /auth/login', () => {
    it('debe iniciar sesión correctamente', async () => {
      const response =
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({
            email: testEmail,
            password: 'Password123',
          })
          .expect(201);

      expect(response.body).toHaveProperty(
        'access_token',
      );

      expect(response.body.user).toHaveProperty(
        'email',
        testEmail,
      );

      userToken =
        response.body.access_token;
    });

    it('debe rechazar credenciales incorrectas', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'PasswordIncorrecta',
        })
        .expect(401);
    });
  });

  describe('GET /users/me', () => {
    it('debe devolver el usuario autenticado', async () => {
      const response =
        await request(app.getHttpServer())
          .get('/users/me')
          .set(
            'Authorization',
            `Bearer ${userToken}`,
          )
          .expect(200);

      expect(response.body).toHaveProperty(
        'id',
        createdUserId,
      );

      expect(response.body).toHaveProperty(
        'email',
        testEmail,
      );

      expect(response.body).not.toHaveProperty(
        'password',
      );
    });

    it('debe rechazar una petición sin token', async () => {
      await request(app.getHttpServer())
        .get('/users/me')
        .expect(401);
    });
  });

  describe('Admin authorization', () => {
    it('debe iniciar sesión como administrador', async () => {
      const response =
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({
            email: 'admin@colsubastas.com',
            password: 'Admin12345',
          })
          .expect(201);

      expect(response.body).toHaveProperty(
        'access_token',
      );

      adminToken =
        response.body.access_token;
    });

    it('debe permitir acceso al administrador', async () => {
      const response =
        await request(app.getHttpServer())
          .get('/users/admin')
          .set(
            'Authorization',
            `Bearer ${adminToken}`,
          )
          .expect(200);

      expect(response.body).toEqual({
        message:
          'Contenido exclusivo para administradores',
      });
    });

    it('debe rechazar al usuario normal', async () => {
      await request(app.getHttpServer())
        .get('/users/admin')
        .set(
          'Authorization',
          `Bearer ${userToken}`,
        )
        .expect(403);
    });
  });

  describe('PATCH /users/me', () => {
    it('debe actualizar el nombre del usuario autenticado', async () => {
      const response = await request(
        app.getHttpServer(),
      )
        .patch('/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Felipe Actualizado' })
        .expect(200);

      expect(response.body.name).toBe(
        'Felipe Actualizado',
      );
      expect(response.body).not.toHaveProperty(
        'password',
      );
    });

    it('debe rechazar cambiar la contraseña con una actual incorrecta', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          currentPassword: 'Incorrecta123',
          newPassword: 'NuevaClave123',
        })
        .expect(400);
    });

    it('debe rechazar una petición vacía', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('Validación de ids', () => {
    it.each(['abc', '0', '-1'])(
      'debe responder 400 para el id inválido %s',
      async (id) => {
        await request(app.getHttpServer())
          .patch(`/users/${id}/status`)
          .set(
            'Authorization',
            `Bearer ${adminToken}`,
          )
          .send({ isActive: false })
          .expect(400);
      },
    );
  });

  describe('POST /auth/logout', () => {
    it('debe cerrar la sesión', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set(
          'Authorization',
          `Bearer ${userToken}`,
        )
        .expect(201);
    });

    it('debe invalidar el token después del logout', async () => {
      await request(app.getHttpServer())
        .get('/users/me')
        .set(
          'Authorization',
          `Bearer ${userToken}`,
        )
        .expect(401);
    });
  });
  describe('Cambio de contraseña', () => {
    it('debe cambiar la contraseña e invalidar el token anterior', async () => {
      const login = await request(
        app.getHttpServer(),
      )
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'Password123',
        })
        .expect(201);

      const token = login.body.access_token;

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'Password123',
          newPassword: 'NuevaClave123',
        })
        .expect(200);

      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'NuevaClave123',
        })
        .expect(201);
    });
  });
});