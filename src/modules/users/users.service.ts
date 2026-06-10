import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

/** User shape returned to clients — never includes password_hash. */
export type SafeUser = Omit<User, 'password_hash'>;

export function toSafeUser(user: User): SafeUser {
  // Strip password_hash regardless of how the entity was loaded.
  const safe = { ...user };
  delete (safe as Partial<User>).password_hash;
  return safe;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepo: Repository<User>,
  ) {}

  /** List users with their role, password_hash stripped. */
  async findAll(): Promise<SafeUser[]> {
    const users = await this.usersRepo.find({ relations: ['role'] });
    return users.map(toSafeUser);
  }

  /** Raw entity (includes password_hash) — for internal use only. */
  findById(id: string): Promise<User | null> {
    return this.usersRepo.findOneBy({ id });
  }

  /** User with role relation, password_hash stripped — safe to return. */
  async findByIdWithRole(id: string): Promise<SafeUser | null> {
    const user = await this.usersRepo.findOne({
      where: { id },
      relations: ['role'],
    });
    return user ? toSafeUser(user) : null;
  }

  /** Raw entity with role relation (includes password_hash) — for auth/login. */
  findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { email },
      relations: ['role'],
    });
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.usersRepo.create(data);
    return this.usersRepo.save(user);
  }
}
