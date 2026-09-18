import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { isEmail } from 'class-validator';
import { User, UserStatus } from '../../modules/users/entities/user.entity';
import { Role } from '../../modules/roles/entities/role.entity';

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;
// Only these seeded roles are admin-tier; ADMIN_ROLE must not select member/front_desk/instructor.
const ADMIN_ROLE_CANDIDATES = ['admin', 'owner'];
const DEFAULT_ADMIN_ROLE = 'admin';

export async function seedAdmin(dataSource: DataSource): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME;
  const requestedRole = process.env.ADMIN_ROLE;

  if (!email || !isEmail(email)) {
    throw new Error('ADMIN_EMAIL is required and must be a valid email address.');
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD is required and must be at least ${MIN_PASSWORD_LENGTH} characters (matches the backend registration policy).`,
    );
  }
  if (requestedRole && !ADMIN_ROLE_CANDIDATES.includes(requestedRole)) {
    throw new Error(
      `ADMIN_ROLE "${requestedRole}" is not an admin-tier role. Allowed: ${ADMIN_ROLE_CANDIDATES.join(', ')}.`,
    );
  }

  const roleRepo = dataSource.getRepository(Role);
  const userRepo = dataSource.getRepository(User);

  const roleName = requestedRole ?? DEFAULT_ADMIN_ROLE;
  const role = await roleRepo.findOneBy({ name: roleName });
  if (!role) {
    const available = (await roleRepo.find()).map((r) => r.name).join(', ') || 'none';
    throw new Error(
      `Role "${roleName}" was not found. Run the RBAC seed (npm run seed) first. Available roles: ${available}.`,
    );
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const existingUser = await userRepo.findOneBy({ email });
  let action: 'created' | 'updated';

  if (!existingUser) {
    if (!fullName) {
      throw new Error('ADMIN_FULL_NAME is required when creating a new admin user.');
    }
    const user = userRepo.create({
      email,
      password_hash,
      full_name: fullName,
      role_id: role.id,
      status: UserStatus.ACTIVE,
    });
    await userRepo.save(user);
    action = 'created';
  } else {
    existingUser.password_hash = password_hash;
    existingUser.role_id = role.id;
    existingUser.status = UserStatus.ACTIVE;
    await userRepo.save(existingUser);
    action = 'updated';
  }

  console.log('[admin-seed] Success.');
  console.log(`  email:  ${email}`);
  console.log(`  role:   ${role.name}`);
  console.log(`  status: ${UserStatus.ACTIVE}`);
  console.log(`  action: ${action}`);
}
