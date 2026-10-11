import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';

import { BidStatus } from '../enums/bid-status.enum';
import { Auction } from '../../auctions/entities/auction.entity';
import { User } from '../../users/entities/user.entity';

@Entity('bids')
export class Bid {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  auctionId: number;

  @Column({ type: 'int' })
  bidderId: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: BidStatus,
    default: BidStatus.VALID,
  })
  status: BidStatus;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Auction, (auction) => auction.bids, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'auctionId' })
  auction: Relation<Auction>;

  @ManyToOne(() => User, (user) => user.bids, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'bidderId' })
  bidder: Relation<User>;


}