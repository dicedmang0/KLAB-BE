import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ClassType } from '../../class-types/entities/class-type.entity';
import { Instructor } from '../../instructors/entities/instructor.entity';
import { Room } from '../../rooms/entities/room.entity';
import { User } from '../../users/entities/user.entity';

export enum ScheduleStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

@Entity('schedules')
export class Schedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  class_type_id: string;

  @ManyToOne(() => ClassType, { eager: false, nullable: false })
  @JoinColumn({ name: 'class_type_id' })
  class_type: ClassType;

  @Column()
  instructor_id: string;

  @ManyToOne(() => Instructor, { eager: false, nullable: false })
  @JoinColumn({ name: 'instructor_id' })
  instructor: Instructor;

  @Column()
  room_id: string;

  @ManyToOne(() => Room, { eager: false, nullable: false })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @Column({ type: 'timestamptz' })
  start_time: Date;

  @Column({ type: 'timestamptz' })
  end_time: Date;

  @Column({ type: 'int' })
  capacity: number;

  @Column({ type: 'enum', enum: ScheduleStatus, default: ScheduleStatus.DRAFT })
  status: ScheduleStatus;

  @Column({ default: false })
  is_published: boolean;

  @Column({ nullable: true })
  recurrence_rule: string;

  @Column({ nullable: true })
  created_by: string;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
