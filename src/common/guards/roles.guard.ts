import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { RolesService } from '../../modules/roles/roles.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private rolesService: RolesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const hasRoles = requiredRoles && requiredRoles.length > 0;
    const hasPermissions = requiredPermissions && requiredPermissions.length > 0;

    // No metadata → no restriction (JwtAuthGuard still enforces authentication).
    if (!hasRoles && !hasPermissions) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Insufficient permissions');

    // Roles check: user's role name must be one of the required roles.
    if (hasRoles && !requiredRoles.includes(user.roleName)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    // Permissions check: user's role must hold at least one required permission.
    if (hasPermissions) {
      if (!user.roleId) throw new ForbiddenException('Insufficient permissions');
      const permissions = await this.rolesService.getPermissionsByRoleId(user.roleId);
      const actions = new Set(permissions.map((p) => p.action));
      const allowed = requiredPermissions.some((action) => actions.has(action));
      if (!allowed) throw new ForbiddenException('Insufficient permissions');
    }

    // When both are present, both checks above must have passed (AND).
    return true;
  }
}
