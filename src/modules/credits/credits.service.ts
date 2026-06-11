import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Member } from '../members/entities/member.entity';
import { CreditLedger, CreditLedgerType } from './entities/credit-ledger.entity';

/** Member-safe ledger entry — strips internal `created_by` admin ID. */
export interface CreditLedgerEntry {
  id: string;
  type: CreditLedgerType;
  amount: number;
  balance_after: number;
  reason: string | null;
  member_package_id: string | null;
  booking_id: string | null;
  created_at: Date;
}

export interface CreditEntryMeta {
  type: CreditLedgerType;
  reason?: string | null;
  bookingId?: string | null;
  memberPackageId?: string | null;
  createdBy?: string | null;
}

export interface CreditAdjustmentResult {
  member_id: string;
  amount: number;
  balance_after: number;
  ledger_id: string;
}

@Injectable()
export class CreditsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Applies a signed delta to a member's balance and writes one immutable
   * credit_ledger row, all within the caller's existing transaction.
   *
   * The caller MUST have already locked the member row (FOR UPDATE) and pass
   * that same entity instance so the in-memory balance stays consistent.
   *
   * @throws BadRequestException if the delta would drive the balance negative.
   */
  async applyDelta(
    manager: EntityManager,
    member: Member,
    delta: number,
    meta: CreditEntryMeta,
  ): Promise<CreditLedger> {
    const newBalance = member.credit_balance + delta;
    if (newBalance < 0) {
      throw new BadRequestException('Insufficient credit balance');
    }

    member.credit_balance = newBalance;
    await manager.save(Member, member);

    const ledger = manager.create(CreditLedger, {
      member_id: member.id,
      type: meta.type,
      amount: delta,
      balance_after: newBalance,
      reason: meta.reason ?? null,
      booking_id: meta.bookingId ?? null,
      member_package_id: meta.memberPackageId ?? null,
      created_by: meta.createdBy ?? null,
    });
    return manager.save(CreditLedger, ledger);
  }

  /**
   * Returns the most recent 50 ledger entries for a member, newest-first.
   * Safe for member-facing endpoints: `created_by` (admin user ID) is stripped.
   */
  async findRecentLedger(memberId: string): Promise<CreditLedgerEntry[]> {
    const rows = await this.dataSource.getRepository(CreditLedger).find({
      where: { member_id: memberId },
      order: { created_at: 'DESC' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      amount: r.amount,
      balance_after: r.balance_after,
      reason: r.reason ?? null,
      member_package_id: r.member_package_id ?? null,
      booking_id: r.booking_id ?? null,
      created_at: r.created_at,
    }));
  }

  /**
   * Manual credit adjustment by an admin. Atomic, immutable ledger entry,
   * records the acting admin, and never lets the balance go negative.
   * `amount` is signed: positive tops up, negative deducts.
   */
  async manualAdjust(
    memberId: string,
    amount: number,
    reason: string,
    adminUserId: string,
  ): Promise<CreditAdjustmentResult> {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new BadRequestException('amount must be a non-zero integer');
    }

    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(Member, {
        where: { id: memberId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member) {
        throw new NotFoundException(`Member ${memberId} not found`);
      }

      const ledger = await this.applyDelta(manager, member, amount, {
        type: CreditLedgerType.MANUAL_ADJUSTMENT,
        reason,
        createdBy: adminUserId,
      });

      return {
        member_id: member.id,
        amount,
        balance_after: ledger.balance_after,
        ledger_id: ledger.id,
      };
    });
  }
}
