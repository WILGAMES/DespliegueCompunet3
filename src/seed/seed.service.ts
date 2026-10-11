import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';

import { User } from '../users/entities/user.entity';
import { Role } from '../users/enums/role.enum';
import { Listing } from '../listings/entities/listing.entity';
import { Auction } from '../auctions/entities/auction.entity';
import { AuctionStatus } from '../auctions/enums/auction-status.enum';
import { Bid } from '../bids/entities/bid.entity';
import { BidStatus } from '../bids/enums/bid-status.enum';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';
import {
  DEMO_LISTINGS,
  DEMO_USERS,
  DemoUserKey,
} from './demo-data';

@Injectable()
export class SeedService
  implements OnModuleInit
{
  private readonly logger =
    new Logger(SeedService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    private readonly configService: ConfigService,

    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedAdmin();

    if (this.isDemoDataEnabled()) {
      await this.seedDemoData();
    }
  }

  /**
   * Datos de demostración activos por defecto. SEED_DEMO_DATA=false los
   * desactiva (producción real). En NODE_ENV=test solo se cargan si
   * SEED_DEMO_DATA=true, para no contaminar las pruebas E2E.
   */
  private isDemoDataEnabled(): boolean {
    const flag =
      this.configService.get<string>(
        'SEED_DEMO_DATA',
      );

    if (flag === 'false') return false;

    if (
      this.configService.get<string>('NODE_ENV') ===
      'test'
    ) {
      return flag === 'true';
    }

    return true;
  }

  /**
   * Carga usuarios, publicaciones, subastas, ofertas y órdenes de
   * ejemplo en distintos estados. Es idempotente: si el primer usuario
   * demo ya existe no hace nada. Todo se inserta en una transacción.
   */
  async seedDemoData(): Promise<boolean> {
    const alreadySeeded =
      await this.usersRepository.exists({
        where: { email: DEMO_USERS[0].email },
      });

    if (alreadySeeded) {
      this.logger.log(
        'Seed: datos de demostración ya existen.',
      );

      return false;
    }

    const password = this.configService.get<string>(
      'SEED_DEMO_PASSWORD',
      'Demo12345',
    );

    if (password.length < 8) {
      throw new Error(
        'SEED_DEMO_PASSWORD debe tener al menos 8 caracteres.',
      );
    }

    const hashedPassword = await bcrypt.hash(
      password,
      10,
    );

    const adminEmail = this.configService
      .get<string>(
        'SEED_ADMIN_EMAIL',
        'admin@colsubastas.com',
      )
      .trim()
      .toLowerCase();

    const hour = 3_600_000;
    const now = Date.now();
    const at = (hours: number) =>
      new Date(now + hours * hour);

    await this.dataSource.transaction(
      async (manager) => {
        const admin = await manager.findOne(User, {
          where: { email: adminEmail },
        });

        const users = {} as Record<
          DemoUserKey,
          User
        >;

        for (const demo of DEMO_USERS) {
          users[demo.key] = await manager.save(
            manager.create(User, {
              name: demo.name,
              email: demo.email,
              password: hashedPassword,
              role: Role.USER,
              isActive: demo.isActive,
              tokenVersion: 0,
            }),
          );
        }

        for (const demo of DEMO_LISTINGS) {
          const reviewed = demo.review !== undefined;

          const listing = await manager.save(
            manager.create(Listing, {
              title: demo.title,
              description: demo.description,
              category: demo.category,
              initialPrice: demo.initialPrice,
              minimumIncrement:
                demo.minimumIncrement,
              durationHours: demo.durationHours,
              status: demo.status,
              aiDecision: demo.ai.decision,
              aiRisk: demo.ai.risk,
              aiReason: demo.ai.reason,
              aiConfidence: demo.ai.confidence,
              aiEvaluatedAt: new Date(),
              reviewReason:
                demo.review?.reason ?? null,
              reviewedById: reviewed
                ? (admin?.id ?? null)
                : null,
              reviewedAt: reviewed
                ? new Date()
                : null,
              sellerId: users[demo.seller].id,
            }),
          );

          if (!demo.auction) continue;

          const spec = demo.auction;
          const highest = spec.bids[spec.bids.length - 1];

          const finished =
            spec.status === AuctionStatus.FINISHED;

          const auction = await manager.save(
            manager.create(Auction, {
              listingId: listing.id,
              sellerId: listing.sellerId,
              startingPrice: demo.initialPrice,
              minimumIncrement:
                demo.minimumIncrement,
              currentPrice: highest
                ? highest[1]
                : demo.initialPrice,
              winnerId:
                finished && highest
                  ? users[highest[0]].id
                  : null,
              status: spec.status,
              startsAt: at(spec.startsInHours),
              endsAt: at(spec.endsInHours),
            }),
          );

          for (const [bidder, amount] of spec.bids) {
            await manager.save(
              manager.create(Bid, {
                auctionId: auction.id,
                bidderId: users[bidder].id,
                amount,
                status: BidStatus.VALID,
              }),
            );
          }

          if (!spec.order || !highest) continue;

          const paid = [
            OrderStatus.PAID,
            OrderStatus.DELIVERED,
          ].includes(spec.order.status);

          const closed = [
            OrderStatus.DELIVERED,
            OrderStatus.CANCELLED,
            OrderStatus.DEFAULTED,
          ].includes(spec.order.status);

          await manager.save(
            manager.create(Order, {
              auctionId: auction.id,
              buyerId: users[highest[0]].id,
              sellerId: listing.sellerId,
              amount: highest[1],
              status: spec.order.status,
              paymentAttempts:
                spec.order.paymentAttempts,
              paymentReference: paid
                ? `SIM-DEMO-${auction.id}`
                : null,
              paidAt: paid ? new Date() : null,
              deliveredAt:
                spec.order.status ===
                OrderStatus.DELIVERED
                  ? new Date()
                  : null,
              closedAt: closed
                ? new Date()
                : null,
              notes: spec.order.notes ?? null,
            }),
          );
        }
      },
    );

    this.logger.log(
      `Seed: datos de demostración creados (${DEMO_USERS.length} usuarios, ${DEMO_LISTINGS.length} publicaciones). Contraseña de los usuarios demo: ${password}`,
    );

    return true;
  }

  private async seedAdmin(): Promise<void> {
    const adminEmail =
      this.configService.get<string>(
        'SEED_ADMIN_EMAIL',
        'admin@colsubastas.com',
      );

    const adminPassword =
      this.configService.get<string>(
        'SEED_ADMIN_PASSWORD',
        'Admin12345',
      );

    const adminName =
      this.configService.get<string>(
        'SEED_ADMIN_NAME',
        'Administrador ColSubastas',
      );

    const existingAdmin =
      await this.usersRepository.findOne({
        where: {
          email: adminEmail.trim().toLowerCase(),
        },
      });

    if (existingAdmin) {
      this.logger.log(
        'Seed: administrador inicial ya existe.',
      );

      return;
    }

    if (adminPassword.length < 8) {
      throw new Error(
        'SEED_ADMIN_PASSWORD debe tener al menos 8 caracteres.',
      );
    }

    const hashedPassword =
      await bcrypt.hash(
        adminPassword,
        10,
      );

    const admin =
      this.usersRepository.create({
        name: adminName.trim(),
        email: adminEmail
          .trim()
          .toLowerCase(),
        password: hashedPassword,
        role: Role.ADMIN,
        isActive: true,
        tokenVersion: 0,
      });

    await this.usersRepository.save(
      admin,
    );

    this.logger.log(
      'Seed: administrador inicial creado correctamente.',
    );
  }
}