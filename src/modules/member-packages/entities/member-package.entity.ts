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

export enum MemberPackageStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  DEPLETED = 'depleted',
  CANCELLED = 'cancelled',
}

/**
 * A package owned by a member. Created for ERD fidelity and the future Payments
 * slice — it is NOT populated by the Bookings + Credits Core slice.
 */
@Entity('member_packages')
export class MemberPackage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  // Payments table does not exist yet — kept as a plain nullable column for now.
  @Column({ nullable: true })
  payment_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  start_date: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expiry_date: Date;

  @Column({ type: 'int', default: 0 })
  credits_total: number;

  @Column({ type: 'int', default: 0 })
  credits_remaining: number;

  @Column({ type: 'enum', enum: MemberPackageStatus, default: MemberPackageStatus.ACTIVE })
  status: MemberPackageStatus;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
