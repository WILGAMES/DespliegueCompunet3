import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { AppThrottlerGuard } from './app-throttler.guard';
import { setupApp, setupSwagger } from './setup-app';

import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

async function createApp(
  env: Record<string, string>,
  extra: { controllers?: any[]; providers?: any[]; imports?: any[] } = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        isGlobal: true,
        load: [() => env],
      }),
      ...(extra.imports ?? []),
    ],
    controllers: [PingController, ...(extra.controllers ?? [])],
    providers: extra.providers ?? [],
  }).compile();

  const app = moduleRef.createNestApplication();

  setupApp(app);
  setupSwagger(app);

  await app.init();

  return app;
}

describe('setupApp / seguridad HTTP', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  describe('helmet', () => {
    it('añade cabeceras de seguridad y oculta X-Powered-By', async () => {
      app = await createApp({});

      const res = await request(app.getHttpServer()).get('/ping').expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('permite solo los orígenes configurados', async () => {
      app = await createApp({
        CORS_ORIGINS: 'https://app.ejemplo.com, http://localhost:5173',
      });

      const allowed = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'http://localhost:5173');

      expect(allowed.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );

      const denied = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'https://malicioso.com');

      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('en producción sin CORS_ORIGINS no permite ningún origen', async () => {
      app = await createApp({ NODE_ENV: 'production' });

      const res = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'https://cualquiera.com');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('en desarrollo sin CORS_ORIGINS permite cualquier origen', async () => {
      app = await createApp({ NODE_ENV: 'development' });

      const res = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'http://localhost:4200');

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:4200',
      );
    });
  });

  describe('Swagger', () => {
    it('es público si no se configuran credenciales', async () => {
      app = await createApp({});

      await request(app.getHttpServer()).get('/docs-json').expect(200);
    });

    it('con SWAGGER_USER y SWAGGER_PASSWORD exige autenticación básica', async () => {
      app = await createApp({
        SWAGGER_USER: 'docs',
        SWAGGER_PASSWORD: 'secreto',
      });

      const server = app.getHttpServer();

      const anonymous = await request(server).get('/docs-json').expect(401);

      expect(anonymous.headers['www-authenticate']).toContain('Basic');

      await request(server)
        .get('/docs-json')
        .auth('docs', 'incorrecta')
        .expect(401);

      await request(server).get('/docs').expect(401);

      await request(server)
        .get('/docs-json')
        .auth('docs', 'secreto')
        .expect(200);
    });

    it('con SWAGGER_ENABLED=false no se expone', async () => {
      app = await createApp({ SWAGGER_ENABLED: 'false' });

      await request(app.getHttpServer()).get('/docs-json').expect(404);
    });
  });

  describe('rate limiting', () => {
    const authServiceMock = {
      login: jest.fn(async () => ({ access_token: 'x' })),
      register: jest.fn(),
      logout: jest.fn(),
    };

    const throttling = () => ({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 1000 }],
        }),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
      ],
    });

    afterEach(() => {
      delete process.env.AUTH_THROTTLE_LIMIT;
    });

    it('limita los intentos de login por IP y responde 429', async () => {
      process.env.AUTH_THROTTLE_LIMIT = '3';

      app = await createApp({}, throttling());

      const server = app.getHttpServer();
      const credentials = { email: 'a@b.com', password: 'Password123' };

      for (let i = 0; i < 3; i++) {
        await request(server).post('/auth/login').send(credentials).expect(201);
      }

      const blocked = await request(server)
        .post('/auth/login')
        .send(credentials)
        .expect(429);

      expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('el límite estricto no afecta a otras rutas', async () => {
      process.env.AUTH_THROTTLE_LIMIT = '1';

      app = await createApp({}, throttling());

      const server = app.getHttpServer();

      await request(server)
        .post('/auth/login')
        .send({ email: 'a@b.com', password: 'Password123' })
        .expect(201);

      await request(server)
        .post('/auth/login')
        .send({ email: 'a@b.com', password: 'Password123' })
        .expect(429);

      for (let i = 0; i < 5; i++) {
        await request(server).get('/ping').expect(200);
      }
    });
  });
});
