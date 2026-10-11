// Debe ser lo primero que se ejecute: las columnas `timestamp` (sin zona
// horaria) se leen y escriben en la hora del proceso, así que todos los
// entornos (local, CI, nube) deben usar la misma: UTC.
process.env.TZ = 'UTC';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { setupApp, setupSwagger } from './common/setup-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  setupApp(app);
  setupSwagger(app);

  const configService = app.get(ConfigService);

  await app.listen(configService.get<number>('PORT', 3000));
}

bootstrap();
