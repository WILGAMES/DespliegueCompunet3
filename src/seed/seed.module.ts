import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Auction } from '../auctions/entities/auction.entity';
import { Bid } from '../bids/entities/bid.entity';
import { Listing } from '../listings/entities/listing.entity';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { SeedService } from './seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Listing,
      Auction,
      Bid,
      Order,
    ]),
  ],
  providers: [SeedService],
})
export class SeedModule {}
