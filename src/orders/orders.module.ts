import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersScheduler } from './orders.scheduler';
import { OrdersService } from './orders.service';

import { Auction } from '../auctions/entities/auction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Auction]),
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersScheduler],
  exports: [OrdersService],
})
export class OrdersModule {}
