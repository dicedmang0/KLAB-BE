import { DataSource } from 'typeorm';
import { Role } from '../../modules/roles/entities/role.entity';
import { Permission } from '../../modules/roles/entities/permission.entity';
import { RolePermission } from '../../modules/roles/entities/role-permission.entity';

const ROLES: Pick<Role, 'name' | 'description' | 'is_system'>[] = [
  { name: 'owner', description: 'Studio owner — full system access', is_system: true },
  { name: 'admin', description: 'Studio administrator', is_system: true },
  { name: 'front_desk', description: 'Front desk staff', is_system: true },
  { name: 'instructor', description: 'Pilates instructor', is_system: true },
  { name: 'member', description: 'Studio member', is_system: true },
];

const PERMISSIONS: Pick<Permission, 'action' | 'description'>[] = [
  // users
  { action: 'users:read_own', description: 'Read own user profile' },
  { action: 'users:read_all', description: 'Read all user profiles' },
  { action: 'users:create', description: 'Create users' },
  { action: 'users:update', description: 'Update users' },
  // roles
  { action: 'roles:read', description: 'Read roles and permissions' },
  { action: 'roles:update', description: 'Update role-permission assignments' },
  // dashboard
  { action: 'dashboard:read', description: 'View admin dashboard' },
  // schedules
  { action: 'schedules:read', description: 'View class schedules' },
  { action: 'schedules:create', description: 'Create class schedules' },
  { action: 'schedules:update', description: 'Update class schedules' },
  { action: 'schedules:cancel', description: 'Cancel class schedules' },
  { action: 'schedules:block_time', description: 'Block time on the schedule' },
  // bookings
  { action: 'bookings:read_own', description: 'Read own bookings' },
  { action: 'bookings:read_all', description: 'Read all bookings' },
  { action: 'bookings:create', description: 'Create bookings' },
  { action: 'bookings:update', description: 'Update bookings' },
  { action: 'bookings:check_in', description: 'Check in a booking' },
  { action: 'bookings:cancel_own', description: 'Cancel own bookings' },
  { action: 'bookings:cancel_any', description: 'Cancel any booking' },
  { action: 'bookings:mark_no_show', description: 'Mark a booking as no-show' },
  // members
  { action: 'members:read', description: 'Read member profiles' },
  { action: 'members:create', description: 'Create member profiles' },
  { action: 'members:update', description: 'Update member profiles' },
  { action: 'members:credit_adjust', description: 'Manually adjust member credits' },
  // class_types
  { action: 'class_types:read', description: 'View class types' },
  { action: 'class_types:create', description: 'Create class types' },
  { action: 'class_types:update', description: 'Update class types' },
  { action: 'class_types:delete', description: 'Delete class types' },
  // packages
  { action: 'packages:read', description: 'View packages' },
  { action: 'packages:create', description: 'Create packages' },
  { action: 'packages:update', description: 'Update packages' },
  { action: 'packages:delete', description: 'Delete packages' },
  { action: 'packages:sell', description: 'Sell a package to a member' },
  // payments
  { action: 'payments:read_own', description: 'Read own payment records' },
  { action: 'payments:read_all', description: 'Read all payment records' },
  { action: 'payments:create_manual', description: 'Record a manual payment' },
  // doku_transactions
  { action: 'doku_transactions:read', description: 'View DOKU transaction logs' },
  { action: 'doku_transactions:retry_sync', description: 'Retry DOKU transaction sync' },
  // reports
  { action: 'reports:read', description: 'View reports' },
  { action: 'reports:export', description: 'Export reports' },
  // cms
  { action: 'cms:read', description: 'View CMS pages' },
  { action: 'cms:update', description: 'Edit CMS pages' },
  // media
  { action: 'media:read', description: 'View media assets' },
  { action: 'media:create', description: 'Upload media assets' },
  { action: 'media:update', description: 'Update media assets' },
  { action: 'media:delete', description: 'Delete media assets' },
  // settings
  { action: 'settings:read', description: 'View studio settings' },
  { action: 'settings:manage', description: 'Manage studio settings' },
  // audit_logs
  { action: 'audit_logs:read', description: 'View audit logs' },
];

const ALL_ACTIONS = PERMISSIONS.map((p) => p.action);

const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ALL_ACTIONS,

  admin: [
    'users:read_all',
    'users:create',
    'users:update',
    'roles:read',
    'dashboard:read',
    'schedules:read',
    'schedules:create',
    'schedules:update',
    'schedules:cancel',
    'schedules:block_time',
    'bookings:read_all',
    'bookings:create',
    'bookings:update',
    'bookings:check_in',
    'bookings:cancel_any',
    'bookings:mark_no_show',
    'members:read',
    'members:create',
    'members:update',
    'members:credit_adjust',
    'class_types:read',
    'class_types:create',
    'class_types:update',
    'class_types:delete',
    'packages:read',
    'packages:create',
    'packages:update',
    'packages:delete',
    'packages:sell',
    'payments:read_all',
    'payments:create_manual',
    'doku_transactions:read',
    'doku_transactions:retry_sync',
    'reports:read',
    'reports:export',
    'cms:read',
    'cms:update',
    'media:read',
    'media:create',
    'media:update',
    'media:delete',
    'settings:read',
    'audit_logs:read',
  ],

  front_desk: [
    'dashboard:read',
    'schedules:read',
    'bookings:read_all',
    'bookings:create',
    'bookings:update',
    'bookings:check_in',
    'bookings:cancel_any',
    'bookings:mark_no_show',
    'members:read',
    'members:create',
    'members:update',
    'class_types:read',
    'packages:read',
    'packages:sell',
    'payments:read_all',
  ],

  instructor: [
    'schedules:read',
    'bookings:read_all',
    'bookings:check_in',
    'bookings:mark_no_show',
    'class_types:read',
  ],

  member: [
    'users:read_own',
    'schedules:read',
    'bookings:read_own',
    'bookings:create',
    'bookings:cancel_own',
    'packages:read',
    'payments:read_own',
  ],
};

export async function seedRbac(dataSource: DataSource): Promise<void> {
  const roleRepo = dataSource.getRepository(Role);
  const permRepo = dataSource.getRepository(Permission);
  const rolePermRepo = dataSource.getRepository(RolePermission);

  await roleRepo.upsert(ROLES as Role[], {
    conflictPaths: ['name'],
    skipUpdateIfNoValuesChanged: true,
  });
  const savedRoles = await roleRepo.find();
  const roleByName = new Map(savedRoles.map((r) => [r.name, r.id]));

  await permRepo.upsert(PERMISSIONS as Permission[], {
    conflictPaths: ['action'],
    skipUpdateIfNoValuesChanged: true,
  });
  const savedPerms = await permRepo.find();
  const permByAction = new Map(savedPerms.map((p) => [p.action, p.id]));

  const entries: { role_id: string; permission_id: string }[] = [];
  for (const [roleName, actions] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleByName.get(roleName);
    if (!roleId) continue;
    for (const action of actions) {
      const permId = permByAction.get(action);
      if (!permId) continue;
      entries.push({ role_id: roleId, permission_id: permId });
    }
  }

  if (entries.length > 0) {
    await rolePermRepo
      .createQueryBuilder()
      .insert()
      .into(RolePermission)
      .values(entries)
      .onConflict(`("role_id", "permission_id") DO NOTHING`)
      .execute();
  }

  console.log(
    `[rbac-seed] roles=${savedRoles.length} permissions=${savedPerms.length} assignments=${entries.length}`,
  );
}
