import { createHash, timingSafeEqual } from 'node:crypto';

import {
  INestApplication,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import { SocketIoAdapter } from './socket-io.adapter';

/**
 * Orígenes permitidos por CORS (API HTTP y Socket.IO).
 * - CORS_ORIGINS="https://app.ejemplo.com,http://localhost:5173": lista.
 * - CORS_ORIGINS="*": cualquiera.
 * - Sin definir: cualquiera en desarrollo; ninguno en producción.
 */
export function resolveCorsOrigins(
  config: ConfigService,
): string[] | boolean {
  const raw = config.get<string>('CORS_ORIGINS')?.trim();

  if (raw === '*') return true;

  if (raw) {
    return raw
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  return config.get<string>('NODE_ENV') !== 'production';
}

export function setupApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Detrás de un balanceador/proxy (EC2, Render...) la IP real del cliente
  // viene en X-Forwarded-For; sin esto el rate limiting vería una sola IP.
  const trustProxy = config.get<string>('TRUST_PROXY');

  if (trustProxy) {
    (app as unknown as { set(key: string, value: unknown): void }).set(
      'trust proxy',
      /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true',
    );
  }

  app.use(
    helmet({
      // Swagger UI necesita scripts y estilos en línea
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'", "'unsafe-inline'"],
        },
      },
      // La API se consume desde otro origen (frontend) vía CORS
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const origins = resolveCorsOrigins(config);

  app.enableCors({ origin: origins, credentials: true });

  app.useWebSocketAdapter(new SocketIoAdapter(app, origins));
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function basicAuth(user: string, password: string) {
  const expectedUser = sha256(user);
  const expectedPassword = sha256(password);

  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';

    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');

      if (separator > -1) {
        const userOk = timingSafeEqual(
          sha256(decoded.slice(0, separator)),
          expectedUser,
        );
        const passwordOk = timingSafeEqual(
          sha256(decoded.slice(separator + 1)),
          expectedPassword,
        );

        if (userOk && passwordOk) return next();
      }
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="ColSubastas docs"');
    res.status(401).send('Autenticación requerida');
  };
}

/**
 * Swagger en /docs.
 * - SWAGGER_ENABLED=false lo desactiva (p. ej. en producción real).
 * - Con SWAGGER_USER y SWAGGER_PASSWORD exige autenticación básica.
 */
export function setupSwagger(app: INestApplication): void {
  const config = app.get(ConfigService);
  const logger = new Logger('Swagger');

  if (config.get<string>('SWAGGER_ENABLED') === 'false') {
    logger.log('Swagger desactivado (SWAGGER_ENABLED=false)');
    return;
  }

  const user = config.get<string>('SWAGGER_USER');
  const password = config.get<string>('SWAGGER_PASSWORD');

  if (user && password) {
    app.use(['/docs', '/docs-json'], basicAuth(user, password));
  } else if (config.get<string>('NODE_ENV') === 'production') {
    logger.warn(
      'Swagger es público en producción. Define SWAGGER_USER y SWAGGER_PASSWORD o SWAGGER_ENABLED=false.',
    );
  }

  const documentConfig = new DocumentBuilder()
    .setTitle('ColSubastas API')
    .setDescription(
      'API REST para la plataforma de subastas en línea ColSubastas. Los eventos en tiempo real (Socket.IO) se describen en el README.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'JWT-auth',
    )
    .build();

  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, documentConfig),
  );
}
