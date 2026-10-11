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

import { OrderStatus } from '../enums/order-status.enum';
import { Auction } from '../../auctions/entities/auction.entity';
import { User } from '../../users/entities/user.entity';

const decimalToNumber = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined
      ? value
      : Number(value),
};

@Entity('orders')
@Check(`"amount" > 0`)
@Check(`"paymentAttempts" >= 0`)
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  // Una orden pertenece a una única subasta (unicidad = idempotencia del cierre)
  @Column({ type: 'int', unique: true })
  auctionId: number;

  @Column({ type: 'int' })
  buyerId: number;

  @Column({ type: 'int' })
  sellerId: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    transformer: decimalToNumber,
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING_PAYMENT,
  })
  status: OrderStatus;

  @Column({ type: 'int', default: 0 })
  paymentAttempts: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  paymentReference: string | null;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;

  /**
   * Fecha límite de pago. Es null cuando el vencimiento automático está
   * desactivado (ORDER_PAYMENT_DEADLINE_HOURS=0).
   */
  @Column({ type: 'timestamptz', nullable: true })
  paymentDueAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => Auction, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'auctionId' })
  auction: Relation<Auction>;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'buyerId' })
  buyer: Relation<User>;

  @ManyToOne(() => User, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'sellerId' })
  seller: Relation<User>;
}
