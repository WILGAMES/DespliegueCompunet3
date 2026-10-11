import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

import { BidsModule } from './bids/bids.module';
import { AuctionsModule } from './auctions/auctions.module';
import { ListingsModule } from './listings/listings.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SeedModule } from './seed/seed.module';
import { OrdersModule } from './orders/orders.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppThrottlerGuard } from './common/app-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (
        config: ConfigService,
      ): TypeOrmModuleOptions => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DB_HOST'),
        port: config.get<number>('POSTGRES_PORT', 5432),
        username: config.getOrThrow<string>(
          'POSTGRES_USER',
        ),
        password: config.getOrThrow<string>(
          'POSTGRES_PASSWORD',
        ),
        database: config.getOrThrow<string>(
          'POSTGRES_DB',
        ),
        autoLoadEntities: true,
        // Conexiones máximas del pool. Los planes gratuitos de Supabase
        // permiten pocas conexiones: mantener un valor bajo.
        poolSize: Number(
          config.get('DB_POOL_MAX', 10),
        ),
        // Sin DB_SYNCHRONIZE explícito: activo en desarrollo y desactivado
        // en producción (NODE_ENV=production), para no alterar el esquema
        // de una base real automáticamente.
        synchronize:
          config.get<string>('DB_SYNCHRONIZE') !== undefined &&
          config.get<string>('DB_SYNCHRONIZE') !== ''
            ? config.get<string>('DB_SYNCHRONIZE') === 'true'
            : config.get<string>('NODE_ENV') !== 'production',
        // SSL activo por defecto (Supabase lo exige).
        // Usar DB_SSL=false con un PostgreSQL local o de CI.
        ssl:
          config.get<string>('DB_SSL') === 'false'
            ? false
            : { rejectUnauthorized: false },
      }),
    }),
    // Límite global de peticiones por IP (anti abuso / fuerza bruta).
    // En NODE_ENV=test se desactiva para no interferir con las pruebas.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: Number(config.get('THROTTLE_TTL_MS', 60_000)),
            limit: Number(config.get('THROTTLE_LIMIT', 300)),
          },
        ],
        skipIf: () => config.get<string>('NODE_ENV') === 'test',
      }),
    }),
    BidsModule,
    OrdersModule,
    AuctionsModule,
    ListingsModule,
    UsersModule,
    AuthModule,
    SeedModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
