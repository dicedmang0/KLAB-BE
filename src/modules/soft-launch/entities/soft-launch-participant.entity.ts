import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum SoftLaunchAllocationSource {
  REGISTRATION = 'registration',
  ADMIN = 'admin',
}

/**
 * Soft-launch booking eligibility for one user. Keyed to `users.id` (the
 * authenticated identity) because registration creates the user before any
 * members row exists. Rows are immutable: written once, never updated/deleted.
 *
 * `code` is a random public reference token (KLAB-SL-XXXXXX). It is display-only:
 * the backend never accepts it as input and it never authorizes anything by
 * itself — eligibility is always resolved from the JWT user.
 */
@Entity('soft_launch_participants')
export class SoftLaunchParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @OneToOne(() => User, { nullable: false, eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ length: 20 })
  code: string;

  // 1..quota. Sequential and internal (admin-only); never part of the public code.
  @Column({ type: 'smallint' })
  slot_no: number;

  @Column()
  source: string;

  // Admin user who allocated manually; null for automatic registration allocation.
  @Column({ nullable: true })
  allocated_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  allocated_at: Date;
}
