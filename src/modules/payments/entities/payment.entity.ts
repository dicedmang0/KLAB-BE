import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { Package } from '../../packages/entities/package.entity';

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
}

/**
 * Internal payment record for a package purchase via DOKU Checkout. Created as
 * `pending` before DOKU is called; a verified paid callback is the ONLY thing
 * that flips it to `paid` and triggers member_package + credit activation.
 */
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Our DOKU `order.invoice_number`. Unique — used to locate the payment on callback.
  @Column()
  payment_code: string;

  @Column()
  member_id: string;

  @ManyToOne(() => Member, { nullable: false, eager: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ nullable: true })
  package_id: string;

  @ManyToOne(() => Package, { nullable: true, eager: false })
  @JoinColumn({ name: 'package_id' })
  package: Package;

  @Column({ type: 'int' })
  amount_idr: number;

  // Payment channel reported by DOKU on the callback (e.g. VIRTUAL_ACCOUNT_BCA).
  @Column({ nullable: true })
  method: string;

  @Column({ default: 'doku' })
  gateway: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  // DOKU token_id / acquirer reference.
  @Column({ nullable: true })
  external_reference: string;

  // DOKU-hosted payment page URL returned to the frontend.
  @Column({ type: 'text', nullable: true })
  checkout_url: string;

  // The DOKU Request-Id we generated for the create-payment call.
  @Column({ nullable: true })
  request_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  paid_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expired_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
