import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PackageStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('packages')
export class Package {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'int', default: 0 })
  price_idr: number;

  @Column({ type: 'int', default: 0 })
  credit_amount: number;

  @Column({ default: false })
  is_unlimited: boolean;

  @Column({ type: 'int' })
  validity_days: number;

  @Column({ default: false })
  is_published: boolean;

  @Column({ type: 'enum', enum: PackageStatus, default: PackageStatus.ACTIVE })
  status: PackageStatus;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
