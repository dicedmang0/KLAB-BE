import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DokuTransaction } from './entities/doku-transaction.entity';
import { ListDokuTransactionsDto } from './dto/list-doku-transactions.dto';

// ── Admin read-only views ─────────────────────────────────────────────────────

export interface DokuTransactionView {
  id: string;
  payment_id: string | null;
  order_id: string | null;
  doku_reference: string | null;
  callback_status: string | null;
  signature_valid: boolean;
  amount_idr: number | null;
  method: string | null;
  transaction_date: Date | null;
  received_at: Date;
  reconciled_at: Date | null;
}

export interface DokuTransactionDetailView extends DokuTransactionView {
  raw_payload: Record<string, unknown>;
}

export interface PaginatedDokuTransactions {
  items: DokuTransactionView[];
  total: number;
  page: number;
  limit: number;
}

function toDokuTransactionView(t: DokuTransaction): DokuTransactionView {
  return {
    id: t.id,
    payment_id: t.payment_id ?? null,
    order_id: t.order_id ?? null,
    doku_reference: t.doku_reference ?? null,
    callback_status: t.callback_status ?? null,
    signature_valid: t.signature_valid,
    amount_idr: t.amount_idr ?? null,
    method: t.method ?? null,
    transaction_date: t.transaction_date ?? null,
    received_at: t.received_at,
    reconciled_at: t.reconciled_at ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface RecordCallbackInput {
  paymentId: string | null;
  dokuReference: string | null;
  orderId: string | null;
  amountIdr: number | null;
  method: string | null;
  transactionDate: Date | null;
  callbackStatus: string | null;
  rawPayload: Record<string, unknown>;
  signatureValid: boolean;
}

@Injectable()
export class DokuTransactionsService {
  constructor(
    @InjectRepository(DokuTransaction)
    private readonly dokuTransactionsRepo: Repository<DokuTransaction>,
  ) {}

  /** Persists one audit row for a received callback (always, even if invalid). */
  async record(input: RecordCallbackInput): Promise<DokuTransaction> {
    const row = this.dokuTransactionsRepo.create({
      payment_id: input.paymentId ?? undefined,
      doku_reference: input.dokuReference ?? undefined,
      order_id: input.orderId ?? undefined,
      amount_idr: input.amountIdr ?? undefined,
      method: input.method ?? undefined,
      transaction_date: input.transactionDate ?? undefined,
      callback_status: input.callbackStatus ?? undefined,
      raw_payload: input.rawPayload,
      signature_valid: input.signatureValid,
    });
    return this.dokuTransactionsRepo.save(row);
  }

  async markReconciled(id: string): Promise<void> {
    await this.dokuTransactionsRepo.update({ id }, { reconciled_at: new Date() });
  }

  // ── Admin read-only queries ────────────────────────────────────────────────

  async findAllForAdmin(filter: ListDokuTransactionsDto): Promise<PaginatedDokuTransactions> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 50;

    const qb = this.dokuTransactionsRepo
      .createQueryBuilder('t')
      .orderBy('t.received_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (filter.callback_status) {
      qb.andWhere('t.callback_status = :callback_status', {
        callback_status: filter.callback_status,
      });
    }
    if (filter.signature_valid !== undefined) {
      qb.andWhere('t.signature_valid = :signature_valid', {
        signature_valid: filter.signature_valid,
      });
    }
    if (filter.order_id) {
      qb.andWhere('t.order_id = :order_id', { order_id: filter.order_id });
    }
    if (filter.from) {
      qb.andWhere('t.received_at >= :from', { from: new Date(filter.from) });
    }
    if (filter.to) {
      qb.andWhere('t.received_at <= :to', { to: new Date(filter.to) });
    }

    const [txns, total] = await qb.getManyAndCount();
    return { items: txns.map(toDokuTransactionView), total, page, limit };
  }

  async findByIdForAdmin(id: string): Promise<DokuTransactionDetailView> {
    const txn = await this.dokuTransactionsRepo.findOneBy({ id });
    if (!txn) throw new NotFoundException(`DokuTransaction ${id} not found`);
    return { ...toDokuTransactionView(txn), raw_payload: txn.raw_payload };
  }

  async findByPaymentIdForAdmin(paymentId: string): Promise<DokuTransactionView[]> {
    const txns = await this.dokuTransactionsRepo.find({
      where: { payment_id: paymentId },
      order: { received_at: 'DESC' },
    });
    return txns.map(toDokuTransactionView);
  }
}
