import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

import { AuctionStatus } from '../enums/auction-status.enum';
import { Listing } from '../../listings/entities/listing.entity';
import { User } from '../../users/entities/user.entity';
import { Bid } from '../../bids/entities/bid.entity';

@Entity('auctions')
export class Auction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', unique: true })
  listingId: number;

  @Column({ type: 'int' })
  sellerId: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  startingPrice: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  minimumIncrement: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  currentPrice: number;

  @Column({ type: 'int', nullable: true })
  winnerId: number | null;

  @Column({
    type: 'enum',
    enum: AuctionStatus,
    default: AuctionStatus.SCHEDULED,
  })
  status: AuctionStatus;

  @Column({ type: 'timestamp' })
  startsAt: Date;

  @Column({ type: 'timestamp' })
  endsAt: Date;

  /** Motivo de la cancelación cuando la decide un administrador. */
  @Column({ type: 'text', nullable: true })
  cancelReason: string | null;

  /** Administrador que canceló la subasta (null si la canceló el vendedor). */
  @Column({ type: 'int', nullable: true })
  cancelledById: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => Listing, (listing) => listing.auction, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'listingId' })
  listing: Relation<Listing>;

  @ManyToOne(() => User, (user) => user.auctions, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'sellerId' })
  seller: Relation<User>;

  @ManyToOne(() => User, (user) => user.wonAuctions, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'winnerId' })
  winner: Relation<User | null>;

  @OneToMany(() => Bid, (bid) => bid.auction)
  bids: Relation<Bid[]>;
}