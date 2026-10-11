import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';

import { Role } from '../enums/role.enum';
import { Listing } from '../../listings/entities/listing.entity';
import { Auction } from '../../auctions/entities/auction.entity';
import { Bid } from '../../bids/entities/bid.entity';

@Entity('users')
@Check(`"tokenVersion" >= 0`)
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    length: 100,
  })
  name: string;

  @Column({
    unique: true,
    length: 150,
  })
  email: string;

  @Column()
  password: string;

  @Column({
    type: 'enum',
    enum: Role,
    default: Role.USER,
  })
  role: Role;

  @Column({
    default: true,
  })
  isActive: boolean;

  @Column({
    default: 0,
  })
  tokenVersion: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Listing, (listing) => listing.seller)
  listings: Relation<Listing[]>;

  @OneToMany(() => Auction, (auction) => auction.seller)
  auctions: Relation<Auction[]>;

  @OneToMany(() => Auction, (auction) => auction.winner)
  wonAuctions: Relation<Auction[]>;

  @OneToMany(() => Bid, (bid) => bid.bidder)
  bids: Relation<Bid[]>;


}