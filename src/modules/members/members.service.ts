import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Member, MemberStatus } from './entities/member.entity';
import { User } from '../users/entities/user.entity';
import { ListMembersDto } from './dto/list-members.dto';
import { ExportMembersDto } from './dto/export-members.dto';

/** Member-facing profile — safe subset for the authenticated member's own view. */
export interface MemberProfileView {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: MemberStatus;
  credit_balance: number;
}

export function toMemberProfileView(member: Member): MemberProfileView {
  return {
    id: member.id,
    user_id: member.user_id ?? null,
    first_name: member.first_name ?? null,
    last_name: member.last_name ?? null,
    email: member.email ?? null,
    phone: member.phone ?? null,
    status: member.status,
    credit_balance: member.credit_balance,
  };
}

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

  /** Safe profile for the authenticated member. Throws if no member row exists yet. */
  async findMemberProfile(userId: string): Promise<MemberProfileView> {
    const member = await this.membersRepo.findOne({ where: { user_id: userId } });
    if (!member) throw new NotFoundException('Member profile not found');
    return toMemberProfileView(member);
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

  /** Read-only migration export, including legacy registrations without a member profile. */
  async exportForVibefam(dto: ExportMembersDto): Promise<string> {
    if (dto.expiry_date < dto.date_purchased) {
      throw new BadRequestException('Expiry date must be on or after date purchased.');
    }

    // Select identities only. Never read passwords or depend on local booking/package data.
    const members: { email: string | null; full_name: string | null }[] = await this.membersRepo
      .query(`
        SELECT COALESCE(NULLIF(BTRIM(u.email), ''), m.email) AS email,
               COALESCE(NULLIF(BTRIM(u.full_name), ''),
                        NULLIF(BTRIM(CONCAT_WS(' ', m.first_name, m.last_name)), '')) AS full_name
        FROM users u
        JOIN roles r ON r.id = u.role_id AND r.name = 'member'
        LEFT JOIN members m ON m.user_id = u.id
        UNION ALL
        SELECT m.email, NULLIF(BTRIM(CONCAT_WS(' ', m.first_name, m.last_name)), '') AS full_name
        FROM members m
        WHERE m.user_id IS NULL
        ORDER BY email
      `);

    if (!members.length) throw new BadRequestException('No members to export.');

    const identities = members.map((m) => ({
      email: m.email?.trim() ?? '',
      name: m.full_name?.trim() ?? '',
    }));
    const invalid = identities.filter((m) => !isEmail(m.email) || !m.name).length;
    const duplicates =
      identities.length - new Set(identities.map((m) => m.email.toLowerCase())).size;
    if (invalid || duplicates) {
      throw new BadRequestException(
        `Export blocked: ${invalid} member(s) have a missing/invalid email or name; ` +
          `${duplicates} duplicate email(s). Correct member data before exporting.`,
      );
    }

    const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const csvDate = (value: string) => value.split('-').reverse().join('/');
    const header =
      'Email,Full name,Package name,Date purchased,Classes left,Expiry date,Price (optional),Renewal cycles left (optional)';
    const rows = identities.map(
      (m) =>
        [
          m.email,
          m.name,
          dto.package_name,
          csvDate(dto.date_purchased),
          dto.classes_left,
          csvDate(dto.expiry_date),
        ]
          .map(csvCell)
          .join(',') + ',,',
    );
    return [header, ...rows, ''].join('\r\n');
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
