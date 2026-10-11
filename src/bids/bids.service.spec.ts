import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { BidsService } from './bids.service';
import { Bid } from './entities/bid.entity';
import { BidStatus } from './enums/bid-status.enum';

import { Auction } from '../auctions/entities/auction.entity';
import { AuctionStatus } from '../auctions/enums/auction-status.enum';
import { Listing } from '../listings/entities/listing.entity';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { AuctionNotFoundException } from '../common/exceptions';
import { RealtimeService } from '../realtime/realtime.service';

describe('BidsService', () => {
  let service: BidsService;

  let auction: Record<string, any> | null;
  let highestBid: Record<string, any> | null;

  const managerMock = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    exists: jest.fn(),
  };

  const dataSourceMock = {
    transaction: jest.fn(),
    manager: managerMock,
  };

  const realtimeMock = {
    publishBid: jest.fn(),
    publishAuctionStatus: jest.fn(),
  };

  const bidsRepositoryMock = {
    find: jest.fn(),
  };

  const baseAuction = () => ({
    id: 1,
    listingId: 7,
    sellerId: 10,
    currentPrice: 1500000,
    minimumIncrement: 50000,
    status: AuctionStatus.ACTIVE,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date('2099-10-05T20:00:00.000Z'),
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    auction = baseAuction();
    highestBid = null;

    managerMock.findOne.mockImplementation(
      async (entity: unknown) =>
        entity === Auction ? auction : highestBid,
    );
    managerMock.create.mockImplementation(
      (_entity: unknown, data: object) => ({
        ...data,
      }),
    );
    managerMock.save.mockImplementation(
      async (value: object) => ({
        id: 99,
        ...value,
      }),
    );
    managerMock.exists.mockResolvedValue(true);

    dataSourceMock.transaction.mockImplementation(
      async (callback: (m: unknown) => unknown) =>
        callback(managerMock),
    );

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          BidsService,
          {
            provide: getRepositoryToken(Bid),
            useValue: bidsRepositoryMock,
          },
          {
            provide: DataSource,
            useValue: dataSourceMock,
          },
          {
            provide: RealtimeService,
            useValue: realtimeMock,
          },
        ],
      }).compile();

    service = module.get(BidsService);
  });

  describe('create', () => {
    it('should lock the auction row inside a transaction', async () => {
      await service.create(1, { amount: 1550000 }, 20);

      expect(dataSourceMock.transaction).toHaveBeenCalled();
      expect(managerMock.findOne).toHaveBeenCalledWith(
        Auction,
        expect.objectContaining({
          where: { id: 1 },
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('should create a valid bid and update the current price', async () => {
      const result = await service.create(
        1,
        { amount: 1550000 },
        20,
      );

      expect(result).toMatchObject({
        auctionId: 1,
        bidderId: 20,
        amount: 1550000,
        status: BidStatus.VALID,
      });

      expect(managerMock.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          currentPrice: 1550000,
        }),
      );
    });

    it('should accept a bid of exactly the minimum', async () => {
      await expect(
        service.create(1, { amount: 1550000 }, 20),
      ).resolves.toBeDefined();
    });

    it('should reject a bid below the minimum increment', async () => {
      await expect(
        service.create(1, { amount: 1549999.99 }, 20),
      ).rejects.toThrow(BadRequestException);

      expect(managerMock.save).not.toHaveBeenCalled();
    });

    it('should throw AuctionNotFoundException when the auction does not exist', async () => {
      auction = null;

      await expect(
        service.create(1, { amount: 1550000 }, 20),
      ).rejects.toThrow(AuctionNotFoundException);
    });

    it('should not let the seller bid on their own auction', async () => {
      await expect(
        service.create(1, { amount: 1550000 }, 10),
      ).rejects.toThrow(ConflictException);
    });

    it('should not let the highest bidder outbid themselves', async () => {
      highestBid = { bidderId: 20, amount: 1550000 };
      auction!.currentPrice = 1550000;

      await expect(
        service.create(1, { amount: 1600000 }, 20),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      AuctionStatus.FINISHED,
      AuctionStatus.CANCELLED,
    ])('should reject bids on a %s auction', async (status) => {
      auction!.status = status;

      await expect(
        service.create(1, { amount: 1550000 }, 20),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject bids after the end date even if still ACTIVE', async () => {
      auction!.endsAt = new Date(Date.now() - 1000);

      await expect(
        service.create(1, { amount: 1550000 }, 20),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject bids before the auction starts', async () => {
      auction!.status = AuctionStatus.SCHEDULED;
      auction!.startsAt = new Date(Date.now() + 3_600_000);

      await expect(
        service.create(1, { amount: 1550000 }, 20),
      ).rejects.toThrow(BadRequestException);
    });

    it('should activate a SCHEDULED auction whose start time has passed', async () => {
      auction!.status = AuctionStatus.SCHEDULED;

      await service.create(1, { amount: 1550000 }, 20);

      expect(managerMock.update).toHaveBeenCalledWith(
        Listing,
        { id: 7 },
        { status: ListingStatus.ACTIVE },
      );

      expect(managerMock.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AuctionStatus.ACTIVE,
        }),
      );
    });
  });

  describe('findByAuction', () => {
    it('should return valid bids ordered by amount', async () => {
      const bids = [{ id: 2 }, { id: 1 }];
      bidsRepositoryMock.find.mockResolvedValue(bids);

      await expect(service.findByAuction(1)).resolves.toBe(
        bids,
      );

      expect(bidsRepositoryMock.find).toHaveBeenCalledWith({
        where: { auctionId: 1, status: BidStatus.VALID },
        order: { amount: 'DESC', createdAt: 'ASC' },
      });
    });

    it('should throw AuctionNotFoundException for an unknown auction', async () => {
      managerMock.exists.mockResolvedValue(false);

      await expect(service.findByAuction(1)).rejects.toThrow(
        AuctionNotFoundException,
      );
    });
  });

  describe('findMine', () => {
    it('should return the bids of the bidder', async () => {
      bidsRepositoryMock.find.mockResolvedValue([{ id: 1 }]);

      await expect(service.findMine(20)).resolves.toEqual([
        { id: 1 },
      ]);

      expect(bidsRepositoryMock.find).toHaveBeenCalledWith({
        where: { bidderId: 20, status: BidStatus.VALID },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('eventos en tiempo real', () => {
    it('publica la puja nueva después de confirmar la transacción', async () => {
      const bid = await service.create(1, { amount: 1550000 }, 20);

      expect(realtimeMock.publishBid).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, currentPrice: 1550000 }),
        bid,
      );
      expect(realtimeMock.publishAuctionStatus).not.toHaveBeenCalled();
    });

    it('no publica nada si la puja se rechaza', async () => {
      await expect(
        service.create(1, { amount: 1 }, 20),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(realtimeMock.publishBid).not.toHaveBeenCalled();
    });

    it('no publica nada si falla la transacción', async () => {
      dataSourceMock.transaction.mockRejectedValueOnce(
        new Error('boom'),
      );

      await expect(
        service.create(1, { amount: 1550000 }, 20),
      ).rejects.toThrow('boom');

      expect(realtimeMock.publishBid).not.toHaveBeenCalled();
    });

    it('si la puja activa una subasta programada publica también su estado', async () => {
      auction = {
        ...baseAuction(),
        status: AuctionStatus.SCHEDULED,
      };

      await service.create(1, { amount: 1550000 }, 20);

      expect(realtimeMock.publishAuctionStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: AuctionStatus.ACTIVE }),
      );
      expect(realtimeMock.publishBid).toHaveBeenCalled();
    });
  });
});
