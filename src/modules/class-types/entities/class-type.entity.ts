import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ClassTypeStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('class_types')
export class ClassType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  category: string;

  @Column({ nullable: true })
  level: string;

  @Column({ type: 'int' })
  duration_minutes: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'int' })
  default_capacity: number;

  @Column({ type: 'int', default: 0 })
  default_price_idr: number;

  @Column({ type: 'int', default: 0 })
  credit_cost: number;

  @Column({ nullable: true })
  image_url: string;

  @Column({ default: false })
  is_published: boolean;

  @Column({ type: 'enum', enum: ClassTypeStatus, default: ClassTypeStatus.ACTIVE })
  status: ClassTypeStatus;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
