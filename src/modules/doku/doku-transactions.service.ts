import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DokuTransaction } from './entities/doku-transaction.entity';

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
}
