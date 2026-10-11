import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Bid } from './entities/bid.entity';
import { BidsController } from './bids.controller';
import { BidsService } from './bids.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Bid]),

    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
  ],

  controllers: [BidsController],
  providers: [BidsService],
  exports: [BidsService],
})
export class BidsModule {}
