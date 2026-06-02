import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private rolesRepo: Repository<Role>,
    @InjectRepository(Permission)
    private permissionsRepo: Repository<Permission>,
    @InjectRepository(RolePermission)
    private rolePermissionsRepo: Repository<RolePermission>,
  ) {}

  findAll(): Promise<Role[]> {
    return this.rolesRepo.find();
  }

  findById(id: string): Promise<Role | null> {
    return this.rolesRepo.findOneBy({ id });
  }

  findByName(name: string): Promise<Role | null> {
    return this.rolesRepo.findOneBy({ name });
  }

  async getPermissionsByRoleId(roleId: string): Promise<Permission[]> {
    const rps = await this.rolePermissionsRepo.find({
      where: { role_id: roleId },
      relations: ['permission'],
    });
    return rps.map((rp) => rp.permission);
  }
}
