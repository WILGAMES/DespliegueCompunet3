import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuctionsService } from './auctions.service';
import { Auction } from './entities/auction.entity';
import { AuctionStatus } from './enums/auction-status.enum';

import { Bid } from '../bids/entities/bid.entity';
import { Listing } from '../listings/entities/listing.entity';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { OrdersService } from '../orders/orders.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  AuctionNotFoundException,
  ListingNotFoundException,
} from '../common/exceptions';

describe('AuctionsService', () => {
  let service: AuctionsService;

  // Estado que devuelve manager.findOne según la entidad pedida
  let listing: Record<string, any> | null;
  let auction: Record<string, any> | null;
  let bid: Record<string, any> | null;

  const managerMock = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    exists: jest.fn(),
  };

  const dataSourceMock = {
    transaction: jest.fn(),
  };

  const auctionsRepositoryMock = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const ordersServiceMock = {
    createForAuction: jest.fn(),
  };

  const realtimeMock = {
    publishAuctionStatus: jest.fn(),
    publishAuctionResult: jest.fn(),
    publishOrder: jest.fn(),
  };

  const HOUR = 3_600_000;

  beforeEach(async () => {
    jest.clearAllMocks();

    listing = null;
    auction = null;
    bid = null;

    managerMock.findOne.mockImplementation(
      async (entity: unknown) => {
        if (entity === Listing) return listing;
        if (entity === Auction) return auction;
        if (entity === Bid) return bid;
        return null;
      },
    );
    managerMock.create.mockImplementation(
      (_entity: unknown, data: object) => ({ ...data }),
    );
    managerMock.save.mockImplementation(
      async (value: object) => ({ id: 5, ...value }),
    );
    managerMock.exists.mockResolvedValue(false);

    dataSourceMock.transaction.mockImplementation(
      async (callback: (m: unknown) => unknown) =>
        callback(managerMock),
    );

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          AuctionsService,
          {
            provide: getRepositoryToken(Auction),
            useValue: auctionsRepositoryMock,
          },
          { provide: DataSource, useValue: dataSourceMock },
          {
            provide: OrdersService,
            useValue: ordersServiceMock,
          },
          {
            provide: RealtimeService,
            useValue: realtimeMock,
          },
        ],
      }).compile();

    service = module.get(AuctionsService);
  });

  describe('create', () => {
    const dto = () => ({
      listingId: 1,
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 6 * HOUR).toISOString(),
    });

    beforeEach(() => {
      listing = {
        id: 1,
        sellerId: 10,
        status: ListingStatus.APPROVED,
        initialPrice: '1500000.00',
        minimumIncrement: '50000.00',
      };
    });

    it('should create an ACTIVE auction when it already started', async () => {
      const result = await service.create(dto(), 10);

      expect(result).toMatchObject({
        listingId: 1,
        sellerId: 10,
        startingPrice: 1500000,
        currentPrice: 1500000,
        minimumIncrement: 50000,
        winnerId: null,
        status: AuctionStatus.ACTIVE,
      });
    });

    it('should lock the listing and move it to ACTIVE', async () => {
      await service.create(dto(), 10);

      expect(managerMock.findOne).toHaveBeenCalledWith(
        Listing,
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
        }),
      );

      expect(listing!.status).toBe(ListingStatus.ACTIVE);
      expect(managerMock.save).toHaveBeenCalledWith(listing);
    });

    it('should create a SCHEDULED auction and listing when it starts later', async () => {
      const result = await service.create(
        {
          ...dto(),
          startsAt: new Date(Date.now() + HOUR).toISOString(),
          endsAt: new Date(Date.now() + 4 * HOUR).toISOString(),
        },
        10,
      );

      expect(result.status).toBe(AuctionStatus.SCHEDULED);
      expect(listing!.status).toBe(ListingStatus.SCHEDULED);
    });

    it('should throw ListingNotFoundException when the listing does not exist', async () => {
      listing = null;

      await expect(service.create(dto(), 10)).rejects.toThrow(
        ListingNotFoundException,
      );
    });

    it('should reject a listing owned by someone else', async () => {
      await expect(service.create(dto(), 99)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it.each([
      ListingStatus.PENDING_REVIEW,
      ListingStatus.REJECTED,
      ListingStatus.ACTIVE,
    ])('should reject a %s listing', async (status) => {
      listing!.status = status;

      await expect(service.create(dto(), 10)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject a listing that already has an auction', async () => {
      auction = { id: 3 };

      await expect(service.create(dto(), 10)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should reject invalid dates', async () => {
      await expect(
        service.create({ ...dto(), startsAt: 'no-es-fecha' }, 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject start >= end', async () => {
      const startsAt = new Date(Date.now() + 2 * HOUR);

      await expect(
        service.create(
          {
            ...dto(),
            startsAt: startsAt.toISOString(),
            endsAt: new Date(
              startsAt.getTime() - HOUR,
            ).toISOString(),
          },
          10,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject an end date in the past', async () => {
      await expect(
        service.create(
          {
            ...dto(),
            startsAt: new Date(Date.now() - 5 * HOUR).toISOString(),
            endsAt: new Date(Date.now() - HOUR).toISOString(),
          },
          10,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['menos de 1 hora', 30 * 60_000],
      ['más de 24 horas', 25 * HOUR],
    ])('should reject a duration of %s', async (_label, ms) => {
      await expect(
        service.create(
          {
            ...dto(),
            startsAt: new Date(Date.now() - 1000).toISOString(),
            endsAt: new Date(Date.now() - 1000 + ms).toISOString(),
          },
          10,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should return the auction', async () => {
      auctionsRepositoryMock.findOne.mockResolvedValue({ id: 1 });

      await expect(service.findOne(1)).resolves.toEqual({ id: 1 });
    });

    it('should throw AuctionNotFoundException', async () => {
      auctionsRepositoryMock.findOne.mockResolvedValue(null);

      await expect(service.findOne(1)).rejects.toThrow(
        AuctionNotFoundException,
      );
    });
  });

  describe('findActive', () => {
    it('should query ACTIVE auctions that have not ended', async () => {
      auctionsRepositoryMock.find.mockResolvedValue([{ id: 1 }]);

      await expect(service.findActive()).resolves.toEqual([
        { id: 1 },
      ]);

      expect(auctionsRepositoryMock.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: AuctionStatus.ACTIVE,
          }),
          order: { endsAt: 'ASC' },
        }),
      );
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      auction = {
        id: 1,
        listingId: 7,
        sellerId: 10,
        status: AuctionStatus.ACTIVE,
      };
    });

    it('should cancel the auction and its listing', async () => {
      const result = await service.cancel(1, 10);

      expect(result.status).toBe(AuctionStatus.CANCELLED);
      expect(managerMock.update).toHaveBeenCalledWith(
        Listing,
        { id: 7 },
        { status: ListingStatus.CANCELLED },
      );
    });

    it('should throw AuctionNotFoundException', async () => {
      auction = null;

      await expect(service.cancel(1, 10)).rejects.toThrow(
        AuctionNotFoundException,
      );
    });

    it('should reject cancelling an auction of someone else', async () => {
      await expect(service.cancel(1, 99)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it.each([
      AuctionStatus.FINISHED,
      AuctionStatus.CANCELLED,
    ])('should reject cancelling a %s auction', async (status) => {
      auction!.status = status;

      await expect(service.cancel(1, 10)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should reject cancelling an auction that has bids', async () => {
      managerMock.exists.mockResolvedValue(true);

      await expect(service.cancel(1, 10)).rejects.toThrow(
        ConflictException,
      );

      expect(managerMock.update).not.toHaveBeenCalled();
    });
  });

  describe('closeAuction', () => {
    beforeEach(() => {
      auction = {
        id: 1,
        listingId: 7,
        sellerId: 10,
        winnerId: null,
        currentPrice: 1500000,
        status: AuctionStatus.ACTIVE,
        endsAt: new Date(Date.now() - 1000),
      };
    });

    it('should set the winner, finish the listing and create the order in the same transaction', async () => {
      bid = { bidderId: 20, amount: '1650000.00' };

      const result = await service.closeAuction(1);

      expect(result).toMatchObject({
        status: AuctionStatus.FINISHED,
        winnerId: 20,
        currentPrice: 1650000,
      });

      expect(managerMock.update).toHaveBeenCalledWith(
        Listing,
        { id: 7 },
        { status: ListingStatus.FINISHED },
      );

      expect(
        ordersServiceMock.createForAuction,
      ).toHaveBeenCalledWith(1, managerMock);

      expect(dataSourceMock.transaction).toHaveBeenCalledTimes(1);
    });

    it('should lock the auction while closing it', async () => {
      await service.closeAuction(1);

      expect(managerMock.findOne).toHaveBeenCalledWith(
        Auction,
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('should finish without winner or order when there are no bids', async () => {
      const result = await service.closeAuction(1);

      expect(result).toMatchObject({
        status: AuctionStatus.FINISHED,
        winnerId: null,
      });

      expect(
        ordersServiceMock.createForAuction,
      ).not.toHaveBeenCalled();

      expect(managerMock.update).toHaveBeenCalledWith(
        Listing,
        { id: 7 },
        { status: ListingStatus.FINISHED },
      );
    });

    it('should do nothing when the auction is already FINISHED or CANCELLED', async () => {
      for (const status of [
        AuctionStatus.FINISHED,
        AuctionStatus.CANCELLED,
      ]) {
        auction!.status = status;

        await expect(service.closeAuction(1)).resolves.toBeNull();
      }

      expect(managerMock.save).not.toHaveBeenCalled();
      expect(
        ordersServiceMock.createForAuction,
      ).not.toHaveBeenCalled();
    });

    it('should not close an auction that has not ended yet', async () => {
      auction!.endsAt = new Date(Date.now() + HOUR);

      await expect(service.closeAuction(1)).resolves.toBeNull();
      expect(managerMock.save).not.toHaveBeenCalled();
    });

    it('should throw AuctionNotFoundException', async () => {
      auction = null;

      await expect(service.closeAuction(1)).rejects.toThrow(
        AuctionNotFoundException,
      );
    });
  });

  describe('closeDueAuctions', () => {
    it('should close each due auction and count the closed ones', async () => {
      auctionsRepositoryMock.find.mockResolvedValue([
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);

      const closeSpy = jest
        .spyOn(service, 'closeAuction')
        .mockResolvedValueOnce({ id: 1 } as Auction)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 3 } as Auction);

      await expect(service.closeDueAuctions()).resolves.toBe(2);
      expect(closeSpy).toHaveBeenCalledTimes(3);
    });

    it('should keep closing the rest when one auction fails', async () => {
      jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      auctionsRepositoryMock.find.mockResolvedValue([
        { id: 1 },
        { id: 2 },
      ]);

      jest
        .spyOn(service, 'closeAuction')
        .mockRejectedValueOnce(new Error('fallo'))
        .mockResolvedValueOnce({ id: 2 } as Auction);

      await expect(service.closeDueAuctions()).resolves.toBe(1);
    });
  });

  describe('activateDueAuctions', () => {
    it('should activate scheduled auctions whose start time passed', async () => {
      auctionsRepositoryMock.find.mockResolvedValue([{ id: 1 }]);

      auction = {
        id: 1,
        listingId: 7,
        status: AuctionStatus.SCHEDULED,
      };

      await expect(service.activateDueAuctions()).resolves.toBe(1);

      expect(auction.status).toBe(AuctionStatus.ACTIVE);
      expect(managerMock.update).toHaveBeenCalledWith(
        Listing,
        { id: 7 },
        { status: ListingStatus.ACTIVE },
      );
    });

    it('should skip auctions another process already changed', async () => {
      auctionsRepositoryMock.find.mockResolvedValue([{ id: 1 }]);

      auction = { id: 1, status: AuctionStatus.ACTIVE };

      await expect(service.activateDueAuctions()).resolves.toBe(0);
      expect(managerMock.update).not.toHaveBeenCalled();
    });
  });

  describe('eventos en tiempo real', () => {
    const closable = () => ({
      id: 1,
      listingId: 7,
      sellerId: 10,
      winnerId: null,
      currentPrice: 1500000,
      status: AuctionStatus.ACTIVE,
      endsAt: new Date(Date.now() - 1000),
    });

    it('al cerrar con ganador publica estado, resultado y orden creada', async () => {
      auction = closable();
      bid = { bidderId: 20, amount: '1650000.00' };

      const order = { id: 3, buyerId: 20, sellerId: 10 };

      ordersServiceMock.createForAuction.mockResolvedValue({
        order,
        created: true,
      });

      await service.closeAuction(1);

      expect(realtimeMock.publishAuctionStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: AuctionStatus.FINISHED }),
      );
      expect(realtimeMock.publishAuctionResult).toHaveBeenCalledWith(
        expect.objectContaining({ winnerId: 20 }),
        order,
      );
      expect(realtimeMock.publishOrder).toHaveBeenCalledWith(
        'created',
        order,
      );
    });

    it('no vuelve a publicar la orden si ya existía', async () => {
      auction = closable();
      bid = { bidderId: 20, amount: '1650000.00' };

      ordersServiceMock.createForAuction.mockResolvedValue({
        order: { id: 3 },
        created: false,
      });

      await service.closeAuction(1);

      expect(realtimeMock.publishOrder).not.toHaveBeenCalled();
    });

    it('un cierre sin ofertas publica el resultado sin orden', async () => {
      auction = closable();

      await service.closeAuction(1);

      expect(realtimeMock.publishAuctionResult).toHaveBeenCalledWith(
        expect.objectContaining({ winnerId: null }),
        null,
      );
      expect(realtimeMock.publishOrder).not.toHaveBeenCalled();
    });

    it('un cierre repetido (ya finalizada) no publica nada', async () => {
      auction = { ...closable(), status: AuctionStatus.FINISHED };

      await service.closeAuction(1);

      expect(realtimeMock.publishAuctionStatus).not.toHaveBeenCalled();
      expect(realtimeMock.publishAuctionResult).not.toHaveBeenCalled();
    });

    it('no publica nada si la transacción falla', async () => {
      auction = closable();
      dataSourceMock.transaction.mockRejectedValueOnce(new Error('boom'));

      await expect(service.closeAuction(1)).rejects.toThrow('boom');

      expect(realtimeMock.publishAuctionStatus).not.toHaveBeenCalled();
    });

    it('publica el estado al crear una subasta', async () => {
      listing = {
        id: 1,
        sellerId: 10,
        status: ListingStatus.APPROVED,
        initialPrice: '1500000.00',
        minimumIncrement: '50000.00',
      };

      await service.create(
        {
          listingId: 1,
          startsAt: new Date(Date.now() - 1000).toISOString(),
          endsAt: new Date(Date.now() + 6 * HOUR).toISOString(),
        },
        10,
      );

      expect(realtimeMock.publishAuctionStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: AuctionStatus.ACTIVE }),
      );
    });

    it('publica el estado al activar y al cancelar', async () => {
      auctionsRepositoryMock.find.mockResolvedValue([{ id: 1 }]);
      auction = { id: 1, listingId: 7, status: AuctionStatus.SCHEDULED };

      await service.activateDueAuctions();

      expect(realtimeMock.publishAuctionStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: AuctionStatus.ACTIVE }),
      );

      realtimeMock.publishAuctionStatus.mockClear();
      auction = {
        id: 1,
        listingId: 7,
        sellerId: 10,
        status: AuctionStatus.ACTIVE,
      };

      await service.cancel(1, 10);

      expect(realtimeMock.publishAuctionStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: AuctionStatus.CANCELLED }),
      );
    });
  });

  describe('adminCancel', () => {
    beforeEach(() => {
      auction = {
        id: 1,
        listingId: 7,
        sellerId: 10,
        winnerId: null,
        status: AuctionStatus.ACTIVE,
      };
    });

    it('cancela una subasta con ofertas: ofertas CANCELLED, publicación CANCELLED y sin ganador', async () => {
      const result = await service.adminCancel(1, 99, '  Fraude  ');

      expect(result).toMatchObject({
        status: AuctionStatus.CANCELLED,
        winnerId: null,
        cancelReason: 'Fraude',
        cancelledById: 99,
      });

      expect(managerMock.update).toHaveBeenCalledWith(
        Bid,
        { auctionId: 1, status: 'VALID' },
        { status: 'CANCELLED' },
      );
      expect(managerMock.update).toHaveBeenCalledWith(
        Listing,
        { id: 7 },
        { status: ListingStatus.CANCELLED },
      );
    });

    it('bloquea la fila de la subasta mientras cancela', async () => {
      await service.adminCancel(1, 99);

      expect(managerMock.findOne).toHaveBeenCalledWith(
        Auction,
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('publica el nuevo estado después de confirmar', async () => {
      await service.adminCancel(1, 99);

      expect(realtimeMock.publishAuctionStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: AuctionStatus.CANCELLED }),
      );
    });

    it('no permite cancelar una subasta finalizada ni ya cancelada', async () => {
      for (const status of [
        AuctionStatus.FINISHED,
        AuctionStatus.CANCELLED,
      ]) {
        auction = { id: 1, listingId: 7, status };

        await expect(
          service.adminCancel(1, 99),
        ).rejects.toBeInstanceOf(ConflictException);
      }

      expect(realtimeMock.publishAuctionStatus).not.toHaveBeenCalled();
    });

    it('lanza AuctionNotFoundException si no existe', async () => {
      auction = null;

      await expect(
        service.adminCancel(1, 99),
      ).rejects.toBeInstanceOf(AuctionNotFoundException);
    });
  });
});
