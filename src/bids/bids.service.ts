import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Bid } from './entities/bid.entity';
import { CreateBidDto } from './dto/create-bid.dto';
import { BidStatus } from './enums/bid-status.enum';

import { Auction } from '../auctions/entities/auction.entity';
import { AuctionStatus } from '../auctions/enums/auction-status.enum';
import { Listing } from '../listings/entities/listing.entity';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { AuctionNotFoundException } from '../common/exceptions';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class BidsService {
  constructor(
    @InjectRepository(Bid)
    private readonly bidsRepository: Repository<Bid>,

    private readonly dataSource: DataSource,

    private readonly realtime: RealtimeService,
  ) {}

  async create(
    auctionId: number,
    createBidDto: CreateBidDto,
    bidderId: number,
  ): Promise<Bid> {
    let activated = false;
    let updatedAuction: Auction | undefined;

    const bid = await this.dataSource.transaction(
      async (manager) => {
        const auction = await manager.findOne(
          Auction,
          {
            where: { id: auctionId },
            lock: { mode: 'pessimistic_write' },
          },
        );

        if (!auction) {
          throw new AuctionNotFoundException(
            auctionId,
          );
        }

        if (auction.sellerId === bidderId) {
          throw new ConflictException(
            'No puedes ofertar en tu propia subasta',
          );
        }

        const now = new Date();

        if (
          auction.status ===
            AuctionStatus.FINISHED ||
          auction.status ===
            AuctionStatus.CANCELLED ||
          now >= auction.endsAt
        ) {
          throw new BadRequestException(
            'La subasta ya finalizó o fue cancelada',
          );
        }

        if (now < auction.startsAt) {
          throw new BadRequestException(
            'La subasta todavía no ha iniciado',
          );
        }

        if (
          auction.status ===
          AuctionStatus.SCHEDULED
        ) {
          auction.status = AuctionStatus.ACTIVE;
          activated = true;

          await manager.update(
            Listing,
            { id: auction.listingId },
            { status: ListingStatus.ACTIVE },
          );
        }

        const highestBid = await manager.findOne(
          Bid,
          {
            where: {
              auctionId,
              status: BidStatus.VALID,
            },
            order: {
              amount: 'DESC',
              createdAt: 'ASC',
            },
          },
        );

        if (highestBid?.bidderId === bidderId) {
          throw new ConflictException(
            'Ya tienes la oferta más alta de esta subasta',
          );
        }

        const minimumBid =
          Number(auction.currentPrice) +
          Number(auction.minimumIncrement);

        if (
          Math.round(createBidDto.amount * 100) <
          Math.round(minimumBid * 100)
        ) {
          throw new BadRequestException(
            `La oferta debe ser de al menos ${minimumBid.toFixed(2)}`,
          );
        }

        const bid = await manager.save(
          manager.create(Bid, {
            auctionId,
            bidderId,
            amount: createBidDto.amount,
            status: BidStatus.VALID,
          }),
        );

        auction.currentPrice =
          createBidDto.amount;

        await manager.save(auction);

        updatedAuction = auction;

        return bid;
      },
    );

    // Después del commit: nunca se anuncia una puja que no quedó guardada
    if (updatedAuction) {
      if (activated) {
        this.realtime.publishAuctionStatus(updatedAuction);
      }

      this.realtime.publishBid(updatedAuction, bid);
    }

    return bid;
  }

  async findByAuction(
    auctionId: number,
  ): Promise<Bid[]> {
    const exists = await this.dataSource.manager.exists(
      Auction,
      { where: { id: auctionId } },
    );

    if (!exists) {
      throw new AuctionNotFoundException(
        auctionId,
      );
    }

    return this.bidsRepository.find({
      where: {
        auctionId,
        status: BidStatus.VALID,
      },
      order: {
        amount: 'DESC',
        createdAt: 'ASC',
      },
    });
  }

  async findMine(
    bidderId: number,
  ): Promise<Bid[]> {
    return this.bidsRepository.find({
      where: {
        bidderId,
        status: BidStatus.VALID,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }
}
