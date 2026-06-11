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
import { Schedule } from '../../schedules/entities/schedule.entity';

export enum BookingStatus {
  PENDING_PAYMENT = 'pending_payment',
  CONFIRMED = 'confirmed',
  WAITLISTED = 'waitlisted',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  NO_SHOW = 'no_show',
}

export enum AttendanceStatus {
  NOT_CHECKED_IN = 'not_checked_in',
  CHECKED_IN = 'checked_in',
  NO_SHOW = 'no_show',
}

export enum BookingSource {
  MEMBER = 'member',
  ADMIN = 'admin',
  FRONT_DESK = 'front_desk',
}

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  booking_code: string;

  @Column()
  member_id: string;

  @ManyToOne(() => Member, { nullable: false, eager: false })
  @JoinColumn({ name: 'member_id' })
  member: Member;

  @Column()
  schedule_id: string;

  @ManyToOne(() => Schedule, { nullable: false, eager: false })
  @JoinColumn({ name: 'schedule_id' })
  schedule: Schedule;

  @Column({ type: 'enum', enum: BookingStatus, default: BookingStatus.CONFIRMED })
  status: BookingStatus;

  @Column({ type: 'enum', enum: AttendanceStatus, default: AttendanceStatus.NOT_CHECKED_IN })
  attendance_status: AttendanceStatus;

  @Column({ default: BookingSource.MEMBER })
  source: string;

  // Snapshot of credits charged at booking time, so refunds are correct even if
  // the class type's credit_cost later changes.
  @Column({ type: 'int', default: 0 })
  credit_cost: number;

  // Points at the booking_debit credit_ledger entry (null when the class is free).
  @Column({ nullable: true })
  credit_ledger_id: string;

  // Payments table does not exist yet — kept as a plain nullable column for now.
  @Column({ nullable: true })
  payment_id: string;

  // Placeholder for the future waitlist slice; not populated here.
  @Column({ type: 'int', nullable: true })
  waitlist_position: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date;
}
