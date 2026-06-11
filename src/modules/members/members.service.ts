import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Member, MemberStatus } from './entities/member.entity';
import { User } from '../users/entities/user.entity';
import { ListMembersDto } from './dto/list-members.dto';

/** Admin-facing member projection — never exposes the linked user's password_hash. */
export interface MemberView {
  id: string;
  user_id: string | null;
  user: { email: string; full_name: string } | null;
  phone: string | null;
  notes: string | null;
  status: MemberStatus;
  credit_balance: number;
  created_at: Date;
  updated_at: Date;
}

export function toMemberView(member: Member): MemberView {
  return {
    id: member.id,
    user_id: member.user_id ?? null,
    user: member.user ? { email: member.user.email, full_name: member.user.full_name } : null,
    phone: member.phone ?? null,
    notes: member.notes ?? null,
    status: member.status,
    credit_balance: member.credit_balance,
    created_at: member.created_at,
    updated_at: member.updated_at,
  };
}

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

  /** Admin list with optional status filter and a free-text `q` search. */
  async findAllForAdmin(filter: ListMembersDto): Promise<MemberView[]> {
    const qb = this.membersRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.user', 'u')
      .orderBy('m.created_at', 'DESC');

    if (filter.status) {
      qb.andWhere('m.status = :status', { status: filter.status });
    }

    if (filter.q) {
      qb.andWhere('(u.email ILIKE :q OR u.full_name ILIKE :q OR m.phone ILIKE :q)', {
        q: `%${filter.q}%`,
      });
    }

    const members = await qb.getMany();
    return members.map(toMemberView);
  }

  /** Admin detail view, including the linked user's email/full_name. */
  async findByIdForAdmin(id: string): Promise<MemberView> {
    const member = await this.membersRepo.findOne({ where: { id }, relations: ['user'] });
    if (!member) throw new NotFoundException(`Member ${id} not found`);
    return toMemberView(member);
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
