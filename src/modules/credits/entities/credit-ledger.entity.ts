import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { MemberPackage } from '../../member-packages/entities/member-package.entity';
import { Booking } from '../../bookings/entities/booking.entity';
import { User } from '../../users/entities/user.entity';

export enum CreditLedgerType {
  PACKAGE_PURCHASE = 'package_purchase',
  BOOKING_DEBIT = 'booking_debit',
  CANCELLATION_REFUND = 'cancellation_refund',
  MANUAL_ADJUSTMENT = 'manual_adjustment',
  EXPIRY = 'expiry',
  NO_SHOW_FORFEIT = 'no_show_forfeit',
}

/**
 * Immutable audit trail of every credit change. `amount` is signed:
 * a debit is negative, a refund / top-up is positive. `balance_after` records
 * the member's running balance after the entry was applied.
 *
 * Rows are never updated or deleted.
 */
@Entity('credit_ledger')
export class CreditLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  member_id: string;

  @ManyToOne(() => Member, { nullable: false, eager: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column({ nullable: true })
  member_package_id: string;

  @ManyToOne(() => MemberPackage, { nullable: true, eager: false })
  @JoinColumn({ name: 'member_package_id' })
  member_package: MemberPackage;

  @Column({ nullable: true })
  booking_id: string;

  @ManyToOne(() => Booking, { nullable: true, eager: false })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ type: 'enum', enum: CreditLedgerType })
  type: CreditLedgerType;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'int' })
  balance_after: number;

  @Column({ nullable: true })
  reason: string;

  @Column({ nullable: true })
  created_by: string;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn()
  created_at: Date;
}
