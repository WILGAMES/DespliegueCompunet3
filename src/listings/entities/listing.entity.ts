import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

import { ListingStatus } from '../enums/listing-status.enum';
import { User } from '../../users/entities/user.entity';
import { Auction } from '../../auctions/entities/auction.entity';

@Entity('listings')
@Check(`"initialPrice" > 0`)
@Check(`"minimumIncrement" > 0`)
@Check(`"durationHours" BETWEEN 1 AND 24`)
@Check(`
  "aiConfidence" IS NULL
  OR (
    "aiConfidence" >= 0
    AND "aiConfidence" <= 1
  )
`)
@Check(`length(btrim("title")) >= 3`)
@Check(`length(btrim("description")) >= 10`)
@Check(`length(btrim("category")) >= 2`)
@Check(`"aiDecision" IS NULL OR "aiDecision" IN ('APPROVE', 'REJECT', 'REVIEW')`)
@Check(`"aiRisk" IS NULL OR "aiRisk" IN ('LOW', 'MEDIUM', 'HIGH')`)
export class Listing {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    length: 150,
  })
  title: string;

  @Column({
    type: 'text',
  })
  description: string;

  @Column({
    length: 100,
  })
  category: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  initialPrice: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  minimumIncrement: number;

  @Column({
    type: 'int',
  })
  durationHours: number;

  @Column({
    type: 'enum',
    enum: ListingStatus,
    default: ListingStatus.DRAFT,
  })
  status: ListingStatus;

  /**
   * Recomendación de la IA (o de las reglas automáticas del sistema).
   * Se guarda separada de la decisión final del administrador.
   */
  @Column({
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  aiDecision: string | null;

  @Column({
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  aiRisk: string | null;

  @Column({
    type: 'text',
    nullable: true,
  })
  aiReason: string | null;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  aiConfidence: number | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
  })
  aiEvaluatedAt: Date | null;

  /** Motivo de la decisión administrativa (aprobación o rechazo). */
  @Column({
    type: 'text',
    nullable: true,
  })
  reviewReason: string | null;

  @Column({
    type: 'int',
    nullable: true,
  })
  reviewedById: number | null;

  /** Administrador que tomó la decisión final. */
  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'reviewedById' })
  reviewedBy: Relation<User> | null;

  @Column({
    type: 'timestamptz',
    nullable: true,
  })
  reviewedAt: Date | null;

  @Column({
    type: 'int',
  })
  sellerId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.listings, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'sellerId' })
  seller: Relation<User>;

  @OneToOne(() => Auction, (auction) => auction.listing)
  auction?: Relation<Auction>;
}