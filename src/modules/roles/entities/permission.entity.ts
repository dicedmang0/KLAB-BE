import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn } from 'typeorm';
import { RolePermission } from './role-permission.entity';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  action: string;

  @Column({ nullable: true })
  description: string;

  @OneToMany(() => RolePermission, (rp) => rp.permission)
  role_permissions: RolePermission[];

  @CreateDateColumn()
  created_at: Date;
}
