import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Member, MemberStatus } from './entities/member.entity';
import { User } from '../users/entities/user.entity';

@Injectable()
export class MembersService {
  constructor(
    @InjectRepository(Member)
    private readonly membersRepo: Repository<Member>,
  ) {}

  findByUserId(userId: string): Promise<Member | null> {
    return this.membersRepo.findOne({ where: { user_id: userId } });
  }

  async findByIdOrFail(id: string): Promise<Member> {
    const member = await this.membersRepo.findOne({ where: { id } });
    if (!member) throw new NotFoundException(`Member ${id} not found`);
    return member;
  }

  /**
   * Returns the member row for a user, creating it on demand from the user's
   * profile. Runs inside the caller's transaction (via `manager`) so member
   * provisioning and the booking it enables commit atomically.
   *
   * Auth/registration is intentionally left untouched — the member row is
   * created lazily here instead.
   */
  async ensureForUser(manager: EntityManager, userId: string): Promise<Member> {
    const repo = manager.getRepository(Member);

    const existing = await repo.findOne({ where: { user_id: userId } });
    if (existing) return existing;

    const user = await manager.getRepository(User).findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const member = repo.create({
      user_id: user.id,
      first_name: user.full_name ?? null,
      email: user.email ?? null,
      phone: user.phone ?? null,
      status: MemberStatus.ACTIVE,
      credit_balance: 0,
    });

    try {
      return await repo.save(member);
    } catch (e) {
      // Lost the race against a concurrent first booking — re-read the winner.
      if ((e as { code?: string }).code === '23505') {
        const again = await repo.findOne({ where: { user_id: userId } });
        if (again) return again;
      }
      throw e;
    }
  }
}
