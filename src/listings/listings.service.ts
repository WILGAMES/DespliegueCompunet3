import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { Listing } from './entities/listing.entity';
import { ListingStatus } from './enums/listing-status.enum';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { AiService } from './ai/ai.service';
import { PROHIBITED_CATEGORIES } from './constants/prohibited-categories';
import { Auction } from '../auctions/entities/auction.entity';
import { AuctionStatus } from '../auctions/enums/auction-status.enum';
import { AuctionsService } from '../auctions/auctions.service';
import { ListingNotFoundException } from '../common/exceptions';
import { RealtimeService } from '../realtime/realtime.service';
import { isForeignKeyViolation } from '../common/utils/db-errors';

@Injectable()
export class ListingsService {
  private readonly publicStatuses = [
    ListingStatus.APPROVED,
    ListingStatus.SCHEDULED,
    ListingStatus.ACTIVE,
    ListingStatus.FINISHED,
  ];

  private readonly suspendableStatuses = [
    ListingStatus.PENDING_REVIEW,
    ListingStatus.APPROVED,
    ListingStatus.SCHEDULED,
    ListingStatus.ACTIVE,
  ];

  constructor(
    @InjectRepository(Listing)
    private readonly listingsRepository: Repository<Listing>,

    private readonly aiService: AiService,

    private readonly dataSource: DataSource,

    private readonly auctionsService: AuctionsService,

    private readonly realtime: RealtimeService,
  ) {}

  async create(
    createListingDto: CreateListingDto,
    sellerId: number,
  ): Promise<Listing> {
    const normalizedData = {
      title: createListingDto.title.trim(),
      description:
        createListingDto.description.trim(),
      category: createListingDto.category.trim(),
      initialPrice: createListingDto.initialPrice,
      minimumIncrement:
        createListingDto.minimumIncrement,
      durationHours: createListingDto.durationHours,
    };

    // Reglas de negocio de la publicación (se evalúan ya normalizadas,
    // es decir, sin espacios al inicio ni al final)
    if (normalizedData.title.length < 3) {
      throw new BadRequestException(
        'El título debe tener al menos 3 caracteres',
      );
    }

    if (normalizedData.description.length < 10) {
      throw new BadRequestException(
        'La descripción debe tener al menos 10 caracteres',
      );
    }

    if (!normalizedData.category) {
      throw new BadRequestException(
        'La categoría es obligatoria',
      );
    }

    if (
      !Number.isFinite(normalizedData.initialPrice) ||
      normalizedData.initialPrice <= 0
    ) {
      throw new BadRequestException(
        'El precio inicial debe ser mayor que 0',
      );
    }

    if (
      !Number.isFinite(
        normalizedData.minimumIncrement,
      ) ||
      normalizedData.minimumIncrement <= 0
    ) {
      throw new BadRequestException(
        'El incremento mínimo debe ser mayor que 0',
      );
    }

    if (
      !Number.isInteger(
        normalizedData.durationHours,
      ) ||
      normalizedData.durationHours < 1 ||
      normalizedData.durationHours > 24
    ) {
      throw new BadRequestException(
        'La duración debe estar entre 1 y 24 horas',
      );
    }

    const existingActiveListing =
      await this.listingsRepository.findOne({
        where: {
          sellerId,
          title: normalizedData.title,
          status: ListingStatus.ACTIVE,
        },
      });

    if (existingActiveListing) {
      throw new ConflictException(
        'Ya tienes una publicación activa con ese título',
      );
    }

   
    const comparableCategory = normalizedData.category
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

    const prohibitedCategory =
      PROHIBITED_CATEGORIES.find((prohibited) =>
        new RegExp(`\\b${prohibited}\\b`).test(
          comparableCategory,
        ),
      );

    if (prohibitedCategory) {
      const rejectedListing =
        this.listingsRepository.create({
          ...normalizedData,
          sellerId,
          status: ListingStatus.REJECTED,
          aiDecision: 'REJECT',
          aiRisk: 'HIGH',
          aiReason: `Regla automática: la categoría "${normalizedData.category}" no está permitida en la plataforma.`,
          aiConfidence: 1,
          aiEvaluatedAt: new Date(),
        });

      return this.listingsRepository.save(
        rejectedListing,
      );
    }

    const aiResult =
      await this.aiService.validateListing(
        normalizedData.title,
        normalizedData.description,
        normalizedData.category,
      );

    const status =
      this.getStatusFromAiDecision(
        aiResult.decision,
      );

    const listing =
      this.listingsRepository.create({
        ...normalizedData,
        sellerId,
        status,
        aiDecision: aiResult.decision,
        aiRisk: aiResult.risk ?? null,
        aiReason: aiResult.reason,
        aiConfidence: aiResult.confidence,
        aiEvaluatedAt: new Date(),
      });

    return this.listingsRepository.save(listing);
  }


  async findAll(): Promise<Listing[]> {
    return this.listingsRepository.find({
      where: {
        status: In(this.publicStatuses),
      },
      order: {
        id: 'DESC',
      },
    });
  }


  async findPendingReview(): Promise<Listing[]> {
    return this.listingsRepository.find({
      where: {
        status: ListingStatus.PENDING_REVIEW,
      },
      order: {
        createdAt: 'ASC',
        id: 'ASC',
      },
    });
  }


  async findOne(id: number): Promise<Listing> {
    const listing =
      await this.listingsRepository.findOne({
        where: { id },
      });

    if (!listing) {
      throw new ListingNotFoundException(id);
    }

    return listing;
  }

 
  async findPublicOne(
    id: number,
  ): Promise<Listing> {
    const listing =
      await this.listingsRepository.findOne({
        where: {
          id,
          status: In(this.publicStatuses),
        },
      });

    if (!listing) {
      throw new ListingNotFoundException(id);
    }

    return listing;
  }

  async findMine(
    sellerId: number,
  ): Promise<Listing[]> {
    return this.listingsRepository.find({
      where: {
        sellerId,
      },
      order: {
        id: 'DESC',
      },
    });
  }

  async update(
    id: number,
    updateListingDto: UpdateListingDto,
    sellerId: number,
  ): Promise<Listing> {
    const listing = await this.findOne(id);

    if (listing.sellerId !== sellerId) {
      throw new ConflictException(
        'No puedes modificar una publicación de otro usuario',
      );
    }

    if (listing.status === ListingStatus.SUSPENDED) {
      throw new ConflictException(
        'La publicación está suspendida por un administrador y no puede modificarse',
      );
    }

    if (
      listing.status === ListingStatus.SCHEDULED ||
      listing.status === ListingStatus.ACTIVE ||
      listing.status === ListingStatus.FINISHED
    ) {
      throw new ConflictException(
        'No puedes modificar una publicación programada, activa o finalizada',
      );
    }

    const updatedData = {
      title:
        updateListingDto.title?.trim() ??
        listing.title.trim(),

      description:
        updateListingDto.description?.trim() ??
        listing.description.trim(),

      category:
        updateListingDto.category?.trim() ??
        listing.category.trim(),

      initialPrice:
        updateListingDto.initialPrice ??
        Number(listing.initialPrice),

      minimumIncrement:
        updateListingDto.minimumIncrement ??
        Number(listing.minimumIncrement),

      durationHours:
        updateListingDto.durationHours ??
        listing.durationHours,
    };

    // Reglas de negocio de la publicación (se evalúan ya normalizadas,
    // es decir, sin espacios al inicio ni al final)
    if (updatedData.title.length < 3) {
      throw new BadRequestException(
        'El título debe tener al menos 3 caracteres',
      );
    }

    if (updatedData.description.length < 10) {
      throw new BadRequestException(
        'La descripción debe tener al menos 10 caracteres',
      );
    }

    if (!updatedData.category) {
      throw new BadRequestException(
        'La categoría es obligatoria',
      );
    }

    if (
      !Number.isFinite(updatedData.initialPrice) ||
      updatedData.initialPrice <= 0
    ) {
      throw new BadRequestException(
        'El precio inicial debe ser mayor que 0',
      );
    }

    if (
      !Number.isFinite(
        updatedData.minimumIncrement,
      ) ||
      updatedData.minimumIncrement <= 0
    ) {
      throw new BadRequestException(
        'El incremento mínimo debe ser mayor que 0',
      );
    }

    if (
      !Number.isInteger(
        updatedData.durationHours,
      ) ||
      updatedData.durationHours < 1 ||
      updatedData.durationHours > 24
    ) {
      throw new BadRequestException(
        'La duración debe estar entre 1 y 24 horas',
      );
    }

    listing.title = updatedData.title;
    listing.description = updatedData.description;
    listing.category = updatedData.category;
    listing.initialPrice =
      updatedData.initialPrice;
    listing.minimumIncrement =
      updatedData.minimumIncrement;
    listing.durationHours =
      updatedData.durationHours;

    // La publicación se evalúa de nuevo
    listing.reviewReason = null;
    listing.reviewedById = null;
    listing.reviewedAt = null;


    const comparableCategory = updatedData.category
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

    const prohibitedCategory =
      PROHIBITED_CATEGORIES.find((prohibited) =>
        new RegExp(`\\b${prohibited}\\b`).test(
          comparableCategory,
        ),
      );

    if (prohibitedCategory) {
      listing.status = ListingStatus.REJECTED;
      listing.aiDecision = 'REJECT';
      listing.aiRisk = 'HIGH';
      listing.aiReason = `Regla automática: la categoría "${updatedData.category}" no está permitida en la plataforma.`;
      listing.aiConfidence = 1;
      listing.aiEvaluatedAt = new Date();

      return this.listingsRepository.save(listing);
    }

    const aiResult =
      await this.aiService.validateListing(
        updatedData.title,
        updatedData.description,
        updatedData.category,
      );

    listing.status =
      this.getStatusFromAiDecision(
        aiResult.decision,
      );

    listing.aiDecision = aiResult.decision;
    listing.aiRisk = aiResult.risk ?? null;
    listing.aiReason = aiResult.reason;
    listing.aiConfidence = aiResult.confidence;
    listing.aiEvaluatedAt = new Date();

    return this.listingsRepository.save(
      listing,
    );
  }

  async remove(
    id: number,
    sellerId: number,
  ): Promise<void> {
    const listing = await this.findOne(id);

    if (listing.sellerId !== sellerId) {
      throw new ConflictException(
        'No puedes eliminar una publicación de otro usuario',
      );
    }

    if (
      listing.status === ListingStatus.ACTIVE
    ) {
      throw new ConflictException(
        'No puedes eliminar una publicación activa',
      );
    }

    try {
      await this.listingsRepository.remove(
        listing,
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'No puedes eliminar una publicación que ya tiene una subasta asociada',
        );
      }

      throw error;
    }
  }

  async approve(
    id: number,
    adminId: number,
  ): Promise<Listing> {
    const listing = await this.findOne(id);

    if (
      listing.status !==
      ListingStatus.PENDING_REVIEW
    ) {
      throw new BadRequestException(
        'La publicación no está pendiente de revisión',
      );
    }

    listing.status =
      ListingStatus.APPROVED;

    listing.reviewReason = null;
    listing.reviewedById = adminId;
    listing.reviewedAt = new Date();

    return this.listingsRepository.save(
      listing,
    );
  }

 
  async reject(
    id: number,
    adminId: number,
    reason?: string,
  ): Promise<Listing> {
    const listing = await this.findOne(id);

    if (
      listing.status !==
      ListingStatus.PENDING_REVIEW
    ) {
      throw new BadRequestException(
        'La publicación no está pendiente de revisión',
      );
    }

    listing.status =
      ListingStatus.REJECTED;

    listing.reviewReason =
      reason?.trim() || null;
    listing.reviewedById = adminId;
    listing.reviewedAt = new Date();

    return this.listingsRepository.save(
      listing,
    );
  }

  /**
   * Suspende una publicación (decisión administrativa). Si tiene una subasta
   * programada o activa, también la cancela: sus ofertas quedan CANCELLED y
   * no hay ganador ni orden. Una publicación finalizada no se puede suspender.
   */
  async suspend(
    id: number,
    adminId: number,
    reason?: string,
  ): Promise<Listing> {
    const cancelled: { auction: Auction | null } = {
      auction: null,
    };

    const suspended = await this.dataSource.transaction(
      async (manager) => {
        const listing = await manager.findOne(Listing, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!listing) {
          throw new ListingNotFoundException(id);
        }

        if (listing.status === ListingStatus.SUSPENDED) {
          throw new ConflictException(
            'La publicación ya está suspendida',
          );
        }

        if (!this.suspendableStatuses.includes(listing.status)) {
          throw new ConflictException(
            `No se puede suspender una publicación en estado ${listing.status}`,
          );
        }

        const auction = await manager.findOne(Auction, {
          where: { listingId: id },
        });

        if (
          auction &&
          (auction.status === AuctionStatus.SCHEDULED ||
            auction.status === AuctionStatus.ACTIVE)
        ) {
          cancelled.auction =
            await this.auctionsService.forceCancel(
              manager,
              auction.id,
              {
                adminId,
                reason,
                listingStatus: ListingStatus.SUSPENDED,
              },
            );
        }

        listing.status = ListingStatus.SUSPENDED;
        listing.reviewReason = reason?.trim() || null;
        listing.reviewedById = adminId;
        listing.reviewedAt = new Date();

        return manager.save(listing);
      },
    );

    if (cancelled.auction) {
      this.realtime.publishAuctionStatus(cancelled.auction);
    }

    return suspended;
  }

  /**
   * Levanta la suspensión. La publicación vuelve a PENDING_REVIEW para que se
   * revise de nuevo. Si ya tuvo una subasta (cancelada al suspender) no se
   * puede reactivar: cada publicación admite una sola subasta.
   */
  async unsuspend(
    id: number,
    adminId: number,
    reason?: string,
  ): Promise<Listing> {
    return this.dataSource.transaction(async (manager) => {
      const listing = await manager.findOne(Listing, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!listing) {
        throw new ListingNotFoundException(id);
      }

      if (listing.status !== ListingStatus.SUSPENDED) {
        throw new BadRequestException(
          'La publicación no está suspendida',
        );
      }

      const hasAuction = await manager.exists(Auction, {
        where: { listingId: id },
      });

      if (hasAuction) {
        throw new ConflictException(
          'La publicación ya tuvo una subasta (cancelada al suspenderla) y no puede reactivarse',
        );
      }

      listing.status = ListingStatus.PENDING_REVIEW;
      listing.reviewReason = reason?.trim() || null;
      listing.reviewedById = adminId;
      listing.reviewedAt = new Date();

      return manager.save(listing);
    });
  }

  private getStatusFromAiDecision(
    decision: string,
  ): ListingStatus {
    switch (decision) {
      case 'APPROVE':
        return ListingStatus.APPROVED;

      case 'REJECT':
        return ListingStatus.REJECTED;

      case 'REVIEW':
      default:
        return ListingStatus.PENDING_REVIEW;
    }
  }
}
