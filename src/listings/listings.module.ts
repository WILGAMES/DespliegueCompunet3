import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ListingsController } from './listings.controller';
import { ListingsAdminController } from './listings-admin.controller';
import { ListingsService } from './listings.service';
import { Listing } from './entities/listing.entity';
import { AiModule } from './ai/ai.module';
import { AuctionsModule } from '../auctions/auctions.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Listing]),
    AiModule,
    AuthModule,
    AuctionsModule,
  ],
  controllers: [
    ListingsController,
    ListingsAdminController,
  ],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}