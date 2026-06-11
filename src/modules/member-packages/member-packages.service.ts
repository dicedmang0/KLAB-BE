import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MemberPackage, MemberPackageStatus } from './entities/member-package.entity';
import { Package, PackageStatus } from '../packages/entities/package.entity';
import { Member } from '../members/entities/member.entity';
import { MembersService } from '../members/members.service';
import { CreditsService } from '../credits/credits.service';
import { CreditLedgerType } from '../credits/entities/credit-ledger.entity';
import { AssignPackageDto } from './dto/assign-package.dto';
import { ListMemberPackagesDto } from './dto/list-member-packages.dto';

/** Outward projection of a member_package — never exposes nested user/auth data. */
export interface MemberPackageView {
  id: string;
  member_id: string;
  package_id: string | null;
  package: { id: string; name: string } | null;
  payment_id: string | null;
  start_date: Date | null;
  expiry_date: Date | null;
  credits_total: number;
  credits_remaining: number;
  status: MemberPackageStatus;
  created_at: Date;
  updated_at: Date;
}

export function toMemberPackageView(mp: MemberPackage): MemberPackageView {
  return {
    id: mp.id,
    member_id: mp.member_id,
    package_id: mp.package_id ?? null,
    package: mp.package ? { id: mp.package.id, name: mp.package.name } : null,
    payment_id: mp.payment_id ?? null,
    start_date: mp.start_date ?? null,
    expiry_date: mp.expiry_date ?? null,
    credits_total: mp.credits_total,
    credits_remaining: mp.credits_remaining,
    status: mp.status,
    created_at: mp.created_at,
    updated_at: mp.updated_at,
  };
}

/** Non-persistent purchase preview returned before the Payments/DOKU slice exists. */
export interface PurchaseIntentView {
  member_id: string;
  package_id: string;
  name: string;
  description: string | null;
  amount_idr: number;
  credit_amount: number;
  is_unlimited: boolean;
  validity_days: number;
  status: 'intent';
  payment_required: true;
  message: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAYMENT_UNAVAILABLE_MESSAGE =
  'Payment (DOKU) integration is not available yet. This is a purchase preview only — ' +
  'no member package or credit has been created.';

@Injectable()
export class MemberPackagesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MemberPackage)
    private readonly memberPackagesRepo: Repository<MemberPackage>,
    @InjectRepository(Package)
    private readonly packagesRepo: Repository<Package>,
    private readonly membersService: MembersService,
    private readonly creditsService: CreditsService,
  ) {}

  // ── Reads ───────────────────────────────────────────────────────────────

  /** Admin list with optional member_id / status filters. */
  async findAllForAdmin(filter: ListMemberPackagesDto): Promise<MemberPackageView[]> {
    const qb = this.memberPackagesRepo
      .createQueryBuilder('mp')
      .leftJoinAndSelect('mp.package', 'pkg')
      .orderBy('mp.created_at', 'DESC');

    if (filter.member_id) {
      qb.andWhere('mp.member_id = :memberId', { memberId: filter.member_id });
    }
    if (filter.status) {
      qb.andWhere('mp.status = :status', { status: filter.status });
    }

    const rows = await qb.getMany();
    return rows.map(toMemberPackageView);
  }

  async findByIdForAdmin(id: string): Promise<MemberPackageView> {
    const mp = await this.memberPackagesRepo.findOne({ where: { id }, relations: ['package'] });
    if (!mp) throw new NotFoundException(`Member package ${id} not found`);
    return toMemberPackageView(mp);
  }

  /** The current member's own packages. Returns [] if the user has no member row yet. */
  async findOwn(userId: string): Promise<MemberPackageView[]> {
    const member = await this.membersService.findByUserId(userId);
    if (!member) return [];
    const rows = await this.memberPackagesRepo.find({
      where: { member_id: member.id },
      relations: ['package'],
      order: { created_at: 'DESC' },
    });
    return rows.map(toMemberPackageView);
  }

  // ── Manual admin assignment ───────────────────────────────────────────────

  /**
   * Manually grant a package to a member (e.g. front-desk / comp sale), atomically:
   *  1. lock the member row FOR UPDATE (serialises credit changes per member);
   *  2. create the active member_package (credits + validity derived from the package);
   *  3. credit the member's balance and write one immutable `package_purchase`
   *     ledger row linked to the new member_package.
   *
   * Unlimited packages (credit_amount = 0) create the member_package but grant no
   * credits and write no ledger row — a 0-amount credit entry would be meaningless.
   *
   * Gated by `packages:sell`: the credit grant here is an intrinsic part of selling
   * a package (ledger type `package_purchase`), distinct from the more sensitive
   * arbitrary `members:credit_adjust` (ledger type `manual_adjustment`).
   */
  async assignToMember(
    memberId: string,
    dto: AssignPackageDto,
    adminUserId: string,
  ): Promise<MemberPackageView> {
    const memberPackageId = await this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(Member, {
        where: { id: memberId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member) throw new NotFoundException(`Member ${memberId} not found`);

      const pkg = await manager.findOne(Package, { where: { id: dto.package_id } });
      if (!pkg) throw new NotFoundException(`Package ${dto.package_id} not found`);
      if (pkg.status !== PackageStatus.ACTIVE) {
        throw new BadRequestException('Package is not active');
      }

      const now = new Date();
      const expiry = new Date(now.getTime() + pkg.validity_days * MS_PER_DAY);

      const memberPackage = manager.create(MemberPackage, {
        member_id: member.id,
        package_id: pkg.id,
        start_date: now,
        expiry_date: expiry,
        credits_total: pkg.credit_amount,
        credits_remaining: pkg.credit_amount,
        status: MemberPackageStatus.ACTIVE,
      });
      const saved = await manager.save(MemberPackage, memberPackage);

      if (pkg.credit_amount > 0) {
        await this.creditsService.applyDelta(manager, member, pkg.credit_amount, {
          type: CreditLedgerType.PACKAGE_PURCHASE,
          reason: dto.reason ?? `Manual package assignment: ${pkg.name}`,
          memberPackageId: saved.id,
          createdBy: adminUserId,
        });
      }

      return saved.id;
    });

    return this.findByIdForAdmin(memberPackageId);
  }

  // ── Member purchase intent (no payment gateway yet) ───────────────────────

  /**
   * Builds a purchase preview for a member without touching credit or persisting
   * anything. Real persistence (payment record + pending activation) lands in the
   * Payments/DOKU slice. Ensures the member row exists so the future flow has a
   * member to attach the purchase to.
   */
  async buildPurchaseIntent(userId: string, packageId: string): Promise<PurchaseIntentView> {
    const member = await this.dataSource.transaction((manager) =>
      this.membersService.ensureForUser(manager, userId),
    );

    const pkg = await this.packagesRepo.findOneBy({ id: packageId });
    if (!pkg) throw new NotFoundException(`Package ${packageId} not found`);
    if (pkg.status !== PackageStatus.ACTIVE || !pkg.is_published) {
      throw new BadRequestException('Package is not available for purchase');
    }

    return {
      member_id: member.id,
      package_id: pkg.id,
      name: pkg.name,
      description: pkg.description ?? null,
      amount_idr: pkg.price_idr,
      credit_amount: pkg.credit_amount,
      is_unlimited: pkg.is_unlimited,
      validity_days: pkg.validity_days,
      status: 'intent',
      payment_required: true,
      message: PAYMENT_UNAVAILABLE_MESSAGE,
    };
  }
}
