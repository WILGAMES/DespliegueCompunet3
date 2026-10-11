import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Auction } from './entities/auction.entity';

import { AuctionsAdminController } from './auctions-admin.controller';
import { AuctionsController } from './auctions.controller';
import { AuctionsScheduler } from './auctions.scheduler';
import { AuctionsService } from './auctions.service';

import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Auction]),

    // El cierre de una subasta genera la orden del ganador
    OrdersModule,

    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
  ],

  controllers: [AuctionsController, AuctionsAdminController],

  providers: [AuctionsService, AuctionsScheduler],

  exports: [AuctionsService],
})
export class AuctionsModule {}
