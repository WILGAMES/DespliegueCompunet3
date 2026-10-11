import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ListingsService } from './listings.service';
import { Listing } from './entities/listing.entity';
import { ListingStatus } from './enums/listing-status.enum';
import { AiService } from './ai/ai.service';
import { ListingNotFoundException } from '../common/exceptions';
import { AuctionsService } from '../auctions/auctions.service';
import { AuctionStatus } from '../auctions/enums/auction-status.enum';
import { RealtimeService } from '../realtime/realtime.service';

describe('ListingsService', () => {
  let service: ListingsService;

  const repositoryMock = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  const aiServiceMock = {
    validateListing: jest.fn(),
  };

  const managerMock = {
    findOne: jest.fn(),
    exists: jest.fn(),
    save: jest.fn(async (value: object) => value),
  };

  const dataSourceMock = {
    transaction: jest.fn((cb: (m: unknown) => unknown) =>
      cb(managerMock),
    ),
  };

  const auctionsServiceMock = {
    forceCancel: jest.fn(),
  };

  const realtimeMock = {
    publishAuctionStatus: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          ListingsService,
          {
            provide: getRepositoryToken(Listing),
            useValue: repositoryMock,
          },
          {
            provide: AiService,
            useValue: aiServiceMock,
          },
          { provide: DataSource, useValue: dataSourceMock },
          {
            provide: AuctionsService,
            useValue: auctionsServiceMock,
          },
          { provide: RealtimeService, useValue: realtimeMock },
        ],
      }).compile();

    service =
      module.get<ListingsService>(
        ListingsService,
      );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const dto = {
      title: 'Laptop Lenovo',
      description:
        'Laptop Lenovo en buen estado para trabajo y estudio.',
      category: 'Tecnología',
      initialPrice: 1500000,
      minimumIncrement: 50000,
      durationHours: 12,
    };

    it('should create an APPROVED listing when Gemini approves it', async () => {
      repositoryMock.findOne.mockResolvedValue(null);

      aiServiceMock.validateListing.mockResolvedValue({
        decision: 'APPROVE',
        reason: 'Producto legítimo',
        confidence: 0.95,
      });

      const listing = {
        id: 1,
        ...dto,
        sellerId: 10,
        status: ListingStatus.APPROVED,
        aiReason: 'Producto legítimo',
        aiConfidence: 0.95,
      };

      repositoryMock.create.mockReturnValue(listing);
      repositoryMock.save.mockResolvedValue(listing);

      const result = await service.create(dto, 10);

      expect(
        aiServiceMock.validateListing,
      ).toHaveBeenCalledWith(
        dto.title,
        dto.description,
        dto.category,
      );

      expect(repositoryMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sellerId: 10,
          status: ListingStatus.APPROVED,
          aiReason: 'Producto legítimo',
          aiConfidence: 0.95,
        }),
      );

      expect(result.status).toBe(
        ListingStatus.APPROVED,
      );
    });

    it('should create a PENDING_REVIEW listing when Gemini requests review', async () => {
      repositoryMock.findOne.mockResolvedValue(null);

      aiServiceMock.validateListing.mockResolvedValue({
        decision: 'REVIEW',
        reason: 'Información insuficiente',
        confidence: 0.4,
      });

      const listing = {
        id: 2,
        ...dto,
        sellerId: 10,
        status: ListingStatus.PENDING_REVIEW,
        aiReason: 'Información insuficiente',
        aiConfidence: 0.4,
      };

      repositoryMock.create.mockReturnValue(listing);
      repositoryMock.save.mockResolvedValue(listing);

      const result = await service.create(dto, 10);

      expect(result.status).toBe(
        ListingStatus.PENDING_REVIEW,
      );
    });

    it('should create a REJECTED listing when Gemini rejects it', async () => {
      repositoryMock.findOne.mockResolvedValue(null);

      aiServiceMock.validateListing.mockResolvedValue({
        decision: 'REJECT',
        reason: 'Producto prohibido',
        confidence: 0.99,
      });

      const listing = {
        id: 3,
        ...dto,
        sellerId: 10,
        status: ListingStatus.REJECTED,
        aiReason: 'Producto prohibido',
        aiConfidence: 0.99,
      };

      repositoryMock.create.mockReturnValue(listing);
      repositoryMock.save.mockResolvedValue(listing);

      const result = await service.create(dto, 10);

      expect(result.status).toBe(
        ListingStatus.REJECTED,
      );
    });

    it('should store the full AI recommendation (decision, risk, reason, confidence, date)', async () => {
      repositoryMock.findOne.mockResolvedValue(null);

      aiServiceMock.validateListing.mockResolvedValue({
        decision: 'REVIEW',
        risk: 'MEDIUM',
        reason: 'Información insuficiente',
        confidence: 0.4,
      });

      repositoryMock.create.mockImplementation(
        (data) => data,
      );
      repositoryMock.save.mockImplementation(
        async (data) => data,
      );

      const result = await service.create(dto, 10);

      expect(result.status).toBe(
        ListingStatus.PENDING_REVIEW,
      );
      expect(result.aiDecision).toBe('REVIEW');
      expect(result.aiRisk).toBe('MEDIUM');
      expect(result.aiReason).toBe(
        'Información insuficiente',
      );
      expect(result.aiConfidence).toBe(0.4);
      expect(result.aiEvaluatedAt).toBeInstanceOf(
        Date,
      );
    });

    it.each([
      'Armas',
      'ARMAS DE FUEGO',
      'Armas y accesorios',
      'Órganos humanos',
      'Drogas',
    ])(
      'should reject the prohibited category "%s" without calling the AI',
      async (category) => {
        repositoryMock.findOne.mockResolvedValue(null);
        repositoryMock.create.mockImplementation(
          (data) => data,
        );
        repositoryMock.save.mockImplementation(
          async (data) => data,
        );

        const result = await service.create(
          { ...dto, category },
          10,
        );

        expect(
          aiServiceMock.validateListing,
        ).not.toHaveBeenCalled();

        expect(result.status).toBe(
          ListingStatus.REJECTED,
        );
        expect(result.aiDecision).toBe('REJECT');
        expect(result.aiRisk).toBe('HIGH');
        expect(result.aiConfidence).toBe(1);
        expect(result.aiReason).toContain(
          'no está permitida',
        );
        expect(result.aiEvaluatedAt).toBeInstanceOf(
          Date,
        );
      },
    );

    it('should not treat a normal category as prohibited', async () => {
      repositoryMock.findOne.mockResolvedValue(null);

      aiServiceMock.validateListing.mockResolvedValue({
        decision: 'APPROVE',
        risk: 'LOW',
        reason: 'Producto válido',
        confidence: 0.95,
      });

      repositoryMock.create.mockImplementation(
        (data) => data,
      );
      repositoryMock.save.mockImplementation(
        async (data) => data,
      );

      const result = await service.create(
        { ...dto, category: 'Juegos de mesa' },
        10,
      );

      expect(
        aiServiceMock.validateListing,
      ).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(
        ListingStatus.APPROVED,
      );
    });

    it('should reject a title that is too short after trimming', async () => {
      await expect(
        service.create(
          { ...dto, title: '  ab  ' },
          10,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(
        aiServiceMock.validateListing,
      ).not.toHaveBeenCalled();
    });

    it('should normalize text fields before saving', async () => {
      repositoryMock.findOne.mockResolvedValue(null);

      aiServiceMock.validateListing.mockResolvedValue({
        decision: 'APPROVE',
        reason: 'Producto válido',
        confidence: 0.95,
      });

      const listing = {
        id: 4,
        sellerId: 10,
        title: 'Laptop Lenovo',
        description:
          'Laptop Lenovo en buen estado.',
        category: 'Tecnología',
        initialPrice: 1500000,
        minimumIncrement: 50000,
        durationHours: 12,
        status: ListingStatus.APPROVED,
        aiReason: 'Producto válido',
        aiConfidence: 0.95,
      };

      repositoryMock.create.mockReturnValue(listing);
      repositoryMock.save.mockResolvedValue(listing);

      await service.create(
        {
          ...dto,
          title: '  Laptop Lenovo  ',
          description:
            '  Laptop Lenovo en buen estado para trabajo y estudio.  ',
          category: '  Tecnología  ',
        },
        10,
      );

      expect(
        aiServiceMock.validateListing,
      ).toHaveBeenCalledWith(
        'Laptop Lenovo',
        'Laptop Lenovo en buen estado para trabajo y estudio.',
        'Tecnología',
      );

      expect(
        repositoryMock.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Laptop Lenovo',
          description:
            'Laptop Lenovo en buen estado para trabajo y estudio.',
          category: 'Tecnología',
        }),
      );
    });

    it('should reject duplicated active listings', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 50,
        title: dto.title,
        sellerId: 10,
        status: ListingStatus.ACTIVE,
      });

      await expect(
        service.create(dto, 10),
      ).rejects.toThrow(ConflictException);

      expect(
        aiServiceMock.validateListing,
      ).not.toHaveBeenCalled();
    });

    it('should reject invalid duration', async () => {
      const invalidDto = {
        ...dto,
        durationHours: 25,
      };

      await expect(
        service.create(invalidDto, 10),
      ).rejects.toThrow(BadRequestException);

      expect(
        repositoryMock.findOne,
      ).not.toHaveBeenCalled();
    });

    it('should reject invalid initial price', async () => {
      const invalidDto = {
        ...dto,
        initialPrice: 0,
      };

      await expect(
        service.create(invalidDto, 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject an empty category', async () => {
      const invalidDto = {
        ...dto,
        category: '   ',
      };

      await expect(
        service.create(invalidDto, 10),
      ).rejects.toThrow(BadRequestException);

      expect(
        aiServiceMock.validateListing,
      ).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return public listings', async () => {
      const listings = [
        {
          id: 1,
          status: ListingStatus.APPROVED,
        },
        {
          id: 2,
          status: ListingStatus.SCHEDULED,
        },
        {
          id: 3,
          status: ListingStatus.ACTIVE,
        },
        {
          id: 4,
          status: ListingStatus.FINISHED,
        },
      ];

      repositoryMock.find.mockResolvedValue(
        listings,
      );

      const result =
        await service.findAll();

      expect(
        repositoryMock.find,
      ).toHaveBeenCalledTimes(1);

      const query =
        repositoryMock.find.mock.calls[0][0];

      expect(query.order).toEqual({
        id: 'DESC',
      });

      expect(
        query.where.status._value,
      ).toEqual([
        ListingStatus.APPROVED,
        ListingStatus.SCHEDULED,
        ListingStatus.ACTIVE,
        ListingStatus.FINISHED,
      ]);

      expect(result).toEqual(listings);
    });
  });

  describe('findOne', () => {
    it('should return a listing', async () => {
      const listing = {
        id: 1,
        title: 'Laptop Lenovo',
      };

      repositoryMock.findOne.mockResolvedValue(
        listing,
      );

      const result =
        await service.findOne(1);

      expect(result).toEqual(listing);
    });

    it('should throw when listing does not exist', async () => {
      repositoryMock.findOne.mockResolvedValue(null);

      await expect(
        service.findOne(999),
      ).rejects.toThrow(ListingNotFoundException);
    });
  });

  describe('findPublicOne', () => {
    it('should return a public listing', async () => {
      const listing = {
        id: 1,
        title: 'Laptop Lenovo',
        status: ListingStatus.APPROVED,
      };

      repositoryMock.findOne.mockResolvedValue(
        listing,
      );

      const result =
        await service.findPublicOne(1);

      const query =
        repositoryMock.findOne.mock.calls[0][0];

      expect(query.where.id).toBe(1);
      expect(
        query.where.status._value,
      ).toEqual([
        ListingStatus.APPROVED,
        ListingStatus.SCHEDULED,
        ListingStatus.ACTIVE,
        ListingStatus.FINISHED,
      ]);

      expect(result).toEqual(listing);
    });

    it('should throw when the listing is not public', async () => {
      repositoryMock.findOne.mockResolvedValue(
        null,
      );

      await expect(
        service.findPublicOne(999),
      ).rejects.toThrow(ListingNotFoundException);
    });
  });

  describe('update', () => {
    it('should prevent another user from modifying the listing', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 1,
        sellerId: 10,
        status: ListingStatus.APPROVED,
      });

      await expect(
        service.update(
          1,
          { title: 'Nuevo título' },
          20,
        ),
      ).rejects.toThrow(ConflictException);

      expect(
        aiServiceMock.validateListing,
      ).not.toHaveBeenCalled();
    });

    it('should prevent modifying an active listing', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 1,
        sellerId: 10,
        status: ListingStatus.ACTIVE,
      });

      await expect(
        service.update(
          1,
          { title: 'Nuevo título' },
          10,
        ),
      ).rejects.toThrow(ConflictException);

      expect(
        aiServiceMock.validateListing,
      ).not.toHaveBeenCalled();
    });

    it('should prevent modifying a scheduled listing (it already has an auction)', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 1,
        sellerId: 10,
        status: ListingStatus.SCHEDULED,
      });

      await expect(
        service.update(
          1,
          { title: 'Nuevo título' },
          10,
        ),
      ).rejects.toThrow(ConflictException);

      expect(
        aiServiceMock.validateListing,
      ).not.toHaveBeenCalled();
    });

    it('should reject a prohibited category on update without calling the AI', async () => {
      const listing = {
        id: 5,
        sellerId: 10,
        title: 'Laptop Lenovo',
        description:
          'Laptop Lenovo en buen estado para trabajo.',
        category: 'Tecnología',
        initialPrice: 1500000,
        minimumIncrement: 50000,
        durationHours: 12,
        status: ListingStatus.APPROVED,
      };

      repositoryMock.findOne.mockResolvedValue(
        listing,
      );
      repositoryMock.save.mockImplementation(
        async (data) => data,
      );

      const result = await service.update(
        5,
        { category: 'Explosivos' },
        10,
      );

      expect(
        aiServiceMock.validateListing,
      ).not.toHaveBeenCalled();
      expect(result.status).toBe(
        ListingStatus.REJECTED,
      );
      expect(result.aiDecision).toBe('REJECT');
    });

    it('should clear the previous administrative decision when the listing is re-evaluated', async () => {
      const listing = {
        id: 6,
        sellerId: 10,
        title: 'Laptop Lenovo',
        description:
          'Laptop Lenovo en buen estado para trabajo.',
        category: 'Tecnología',
        initialPrice: 1500000,
        minimumIncrement: 50000,
        durationHours: 12,
        status: ListingStatus.REJECTED,
        reviewReason: 'Falta información',
        reviewedById: 99,
        reviewedAt: new Date(),
      };

      repositoryMock.findOne.mockResolvedValue(
        listing,
      );

      aiServiceMock.validateListing.mockResolvedValue({
        decision: 'APPROVE',
        risk: 'LOW',
        reason: 'Producto válido',
        confidence: 0.95,
      });

      repositoryMock.save.mockImplementation(
        async (data) => data,
      );

      const result = await service.update(
        6,
        {
          description:
            'Laptop Lenovo en buen estado, con cargador y factura.',
        },
        10,
      );

      expect(result.status).toBe(
        ListingStatus.APPROVED,
      );
      expect(result.reviewReason).toBeNull();
      expect(result.reviewedById).toBeNull();
      expect(result.reviewedAt).toBeNull();
      expect(result.aiRisk).toBe('LOW');
    });

    it('should revalidate the listing with Gemini after updating it', async () => {
      const listing = {
        id: 1,
        sellerId: 10,
        title: 'Laptop Lenovo',
        description:
          'Laptop Lenovo en buen estado para trabajo.',
        category: 'Tecnología',
        initialPrice: 1500000,
        minimumIncrement: 50000,
        durationHours: 12,
        status: ListingStatus.APPROVED,
        aiReason: 'Producto válido',
        aiConfidence: 0.95,
      };

      repositoryMock.findOne.mockResolvedValue(
        listing,
      );

      aiServiceMock.validateListing.mockResolvedValue({
        decision: 'REJECT',
        reason: 'Contenido no permitido',
        confidence: 0.98,
      });

      repositoryMock.save.mockResolvedValue({
        ...listing,
        title: 'Producto modificado',
        status: ListingStatus.REJECTED,
        aiReason: 'Contenido no permitido',
        aiConfidence: 0.98,
      });

      const result = await service.update(
        1,
        {
          title: '  Producto modificado  ',
        },
        10,
      );

      expect(
        aiServiceMock.validateListing,
      ).toHaveBeenCalledWith(
        'Producto modificado',
        'Laptop Lenovo en buen estado para trabajo.',
        'Tecnología',
      );

      expect(listing.title).toBe(
        'Producto modificado',
      );

      expect(result.status).toBe(
        ListingStatus.REJECTED,
      );

      expect(result.aiReason).toBe(
        'Contenido no permitido',
      );

      expect(result.aiConfidence).toBe(0.98);
    });

    it('should set PENDING_REVIEW when Gemini requests review after updating', async () => {
      const listing = {
        id: 2,
        sellerId: 10,
        title: 'Laptop Lenovo',
        description:
          'Laptop Lenovo en buen estado para trabajo.',
        category: 'Tecnología',
        initialPrice: 1500000,
        minimumIncrement: 50000,
        durationHours: 12,
        status: ListingStatus.APPROVED,
        aiReason: 'Producto válido',
        aiConfidence: 0.95,
      };

      repositoryMock.findOne.mockResolvedValue(
        listing,
      );

      aiServiceMock.validateListing.mockResolvedValue({
        decision: 'REVIEW',
        reason: 'Requiere revisión',
        confidence: 0.45,
      });

      repositoryMock.save.mockResolvedValue({
        ...listing,
        status: ListingStatus.PENDING_REVIEW,
        aiReason: 'Requiere revisión',
        aiConfidence: 0.45,
      });

      const result = await service.update(
        2,
        {
          description:
            'Descripción modificada que requiere revisión administrativa.',
        },
        10,
      );

      expect(result.status).toBe(
        ListingStatus.PENDING_REVIEW,
      );

      expect(result.aiReason).toBe(
        'Requiere revisión',
      );

      expect(result.aiConfidence).toBe(0.45);
    });

    it('should reject invalid data after update', async () => {
      const listing = {
        id: 3,
        sellerId: 10,
        title: 'Laptop Lenovo',
        description:
          'Laptop Lenovo en buen estado para trabajo.',
        category: 'Tecnología',
        initialPrice: 1500000,
        minimumIncrement: 50000,
        durationHours: 12,
        status: ListingStatus.APPROVED,
      };

      repositoryMock.findOne.mockResolvedValue(
        listing,
      );

      await expect(
        service.update(
          3,
          {
            title: '  ',
          },
          10,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(
        aiServiceMock.validateListing,
      ).not.toHaveBeenCalled();

      expect(
        repositoryMock.save,
      ).not.toHaveBeenCalled();
    });
  });

  describe('findPendingReview', () => {
    it('should return the listings pending review, oldest first', async () => {
      const listings = [
        { id: 1, status: ListingStatus.PENDING_REVIEW },
        { id: 2, status: ListingStatus.PENDING_REVIEW },
      ];

      repositoryMock.find.mockResolvedValue(
        listings,
      );

      const result =
        await service.findPendingReview();

      expect(repositoryMock.find).toHaveBeenCalledWith(
        {
          where: {
            status: ListingStatus.PENDING_REVIEW,
          },
          order: { createdAt: 'ASC', id: 'ASC' },
        },
      );

      expect(result).toEqual(listings);
    });
  });

  describe('approve', () => {
    it('should approve a listing pending review and record who decided', async () => {
      const listing = {
        id: 1,
        status: ListingStatus.PENDING_REVIEW,
        aiDecision: 'REVIEW',
        aiRisk: 'MEDIUM',
        aiReason: 'Información insuficiente',
        reviewReason: null,
        reviewedById: null,
        reviewedAt: null,
      };

      repositoryMock.findOne.mockResolvedValue(
        listing,
      );
      repositoryMock.save.mockImplementation(
        async (data) => data,
      );

      const result = await service.approve(1, 99);

      expect(result.status).toBe(
        ListingStatus.APPROVED,
      );
      expect(result.reviewedById).toBe(99);
      expect(result.reviewedAt).toBeInstanceOf(Date);

      // La recomendación de la IA no se modifica
      expect(result.aiDecision).toBe('REVIEW');
      expect(result.aiRisk).toBe('MEDIUM');
      expect(result.aiReason).toBe(
        'Información insuficiente',
      );
    });

    it('should not approve a listing that is not pending review', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 1,
        status: ListingStatus.APPROVED,
      });

      await expect(
        service.approve(1, 99),
      ).rejects.toThrow(BadRequestException);

      expect(repositoryMock.save).not.toHaveBeenCalled();
    });

    it('should throw when the listing does not exist', async () => {
      repositoryMock.findOne.mockResolvedValue(null);

      await expect(
        service.approve(999, 99),
      ).rejects.toThrow(ListingNotFoundException);
    });
  });

  describe('reject', () => {
    it('should reject a listing and keep the AI reason separate from the admin reason', async () => {
      const listing = {
        id: 1,
        status: ListingStatus.PENDING_REVIEW,
        aiReason: 'Información insuficiente',
        reviewReason: null,
        reviewedById: null,
        reviewedAt: null,
      };

      repositoryMock.findOne.mockResolvedValue(
        listing,
      );
      repositoryMock.save.mockImplementation(
        async (data) => data,
      );

      const result = await service.reject(
        1,
        99,
        '  Revisión administrativa  ',
      );

      expect(result.status).toBe(
        ListingStatus.REJECTED,
      );
      expect(result.reviewReason).toBe(
        'Revisión administrativa',
      );
      expect(result.reviewedById).toBe(99);
      expect(result.reviewedAt).toBeInstanceOf(Date);

      // La razón de la IA no se sobrescribe
      expect(result.aiReason).toBe(
        'Información insuficiente',
      );
    });

    it('should store a null reason when none is given', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 2,
        status: ListingStatus.PENDING_REVIEW,
      });
      repositoryMock.save.mockImplementation(
        async (data) => data,
      );

      const result = await service.reject(2, 99);

      expect(result.reviewReason).toBeNull();
    });

    it('should not reject a listing that is not pending review', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 3,
        status: ListingStatus.ACTIVE,
      });

      await expect(
        service.reject(3, 99, 'Motivo'),
      ).rejects.toThrow(BadRequestException);

      expect(repositoryMock.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const listing = {
      id: 5,
      sellerId: 10,
      status: ListingStatus.APPROVED,
    };

    it('should remove a listing owned by the seller', async () => {
      repositoryMock.findOne.mockResolvedValue(
        listing,
      );
      repositoryMock.remove.mockResolvedValue(listing);

      await service.remove(5, 10);

      expect(repositoryMock.remove).toHaveBeenCalledWith(
        listing,
      );
    });

    it('should not remove a listing that belongs to another user', async () => {
      repositoryMock.findOne.mockResolvedValue(
        listing,
      );

      await expect(
        service.remove(5, 99),
      ).rejects.toThrow(ConflictException);

      expect(repositoryMock.remove).not.toHaveBeenCalled();
    });

    it('should not remove an active listing', async () => {
      repositoryMock.findOne.mockResolvedValue({
        ...listing,
        status: ListingStatus.ACTIVE,
      });

      await expect(
        service.remove(5, 10),
      ).rejects.toThrow(ConflictException);
    });

    it('should answer 409 when the listing already has an auction (foreign key)', async () => {
      repositoryMock.findOne.mockResolvedValue(
        listing,
      );
      repositoryMock.remove.mockRejectedValue({
        driverError: { code: '23503' },
      });

      await expect(
        service.remove(5, 10),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('suspend', () => {
    const listing = (status: ListingStatus) => ({
      id: 5,
      status,
      reviewReason: null,
      reviewedById: null,
      reviewedAt: null,
    });

    beforeEach(() => {
      managerMock.findOne.mockReset();
      managerMock.exists.mockReset();
      managerMock.save.mockClear();
    });

    it('suspende una publicación sin subasta', async () => {
      managerMock.findOne
        .mockResolvedValueOnce(listing(ListingStatus.APPROVED))
        .mockResolvedValueOnce(null);

      const result = await service.suspend(5, 99, '  Contenido dudoso ');

      expect(result).toMatchObject({
        status: ListingStatus.SUSPENDED,
        reviewReason: 'Contenido dudoso',
        reviewedById: 99,
      });
      expect(auctionsServiceMock.forceCancel).not.toHaveBeenCalled();
      expect(realtimeMock.publishAuctionStatus).not.toHaveBeenCalled();
    });

    it('cancela la subasta activa o programada y publica su estado', async () => {
      const cancelledAuction = {
        id: 8,
        status: AuctionStatus.CANCELLED,
      };

      managerMock.findOne
        .mockResolvedValueOnce(listing(ListingStatus.ACTIVE))
        .mockResolvedValueOnce({ id: 8, status: AuctionStatus.ACTIVE });
      auctionsServiceMock.forceCancel.mockResolvedValue(cancelledAuction);

      const result = await service.suspend(5, 99, 'Fraude');

      expect(auctionsServiceMock.forceCancel).toHaveBeenCalledWith(
        managerMock,
        8,
        {
          adminId: 99,
          reason: 'Fraude',
          listingStatus: ListingStatus.SUSPENDED,
        },
      );
      expect(result.status).toBe(ListingStatus.SUSPENDED);
      expect(realtimeMock.publishAuctionStatus).toHaveBeenCalledWith(
        cancelledAuction,
      );
    });

    it('rechaza suspender una publicación ya suspendida', async () => {
      managerMock.findOne.mockResolvedValueOnce(
        listing(ListingStatus.SUSPENDED),
      );

      await expect(service.suspend(5, 99)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it.each([
      ListingStatus.FINISHED,
      ListingStatus.REJECTED,
      ListingStatus.CANCELLED,
      ListingStatus.DRAFT,
    ])('no permite suspender una publicación %s', async (status) => {
      managerMock.findOne.mockResolvedValueOnce(listing(status));

      await expect(service.suspend(5, 99)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(managerMock.save).not.toHaveBeenCalled();
    });

    it('lanza ListingNotFoundException si no existe', async () => {
      managerMock.findOne.mockResolvedValueOnce(null);

      await expect(service.suspend(5, 99)).rejects.toBeInstanceOf(
        ListingNotFoundException,
      );
    });

    it('el vendedor no puede editar una publicación suspendida', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 5,
        sellerId: 10,
        status: ListingStatus.SUSPENDED,
      });

      await expect(
        service.update(5, { title: 'Nuevo título' }, 10),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(aiServiceMock.validateListing).not.toHaveBeenCalled();
    });
  });

  describe('unsuspend', () => {
    beforeEach(() => {
      managerMock.findOne.mockReset();
      managerMock.exists.mockReset();
    });

    it('devuelve la publicación a revisión', async () => {
      managerMock.findOne.mockResolvedValueOnce({
        id: 5,
        status: ListingStatus.SUSPENDED,
      });
      managerMock.exists.mockResolvedValueOnce(false);

      const result = await service.unsuspend(5, 99, 'Aclarado');

      expect(result).toMatchObject({
        status: ListingStatus.PENDING_REVIEW,
        reviewedById: 99,
      });
    });

    it('rechaza si la publicación no está suspendida', async () => {
      managerMock.findOne.mockResolvedValueOnce({
        id: 5,
        status: ListingStatus.APPROVED,
      });

      await expect(service.unsuspend(5, 99)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rechaza si la publicación ya tuvo una subasta', async () => {
      managerMock.findOne.mockResolvedValueOnce({
        id: 5,
        status: ListingStatus.SUSPENDED,
      });
      managerMock.exists.mockResolvedValueOnce(true);

      await expect(service.unsuspend(5, 99)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
