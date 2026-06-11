import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Payment } from '../../payments/entities/payment.entity';

/**
 * Audit log of every DOKU callback received. One row per callback — including
 * duplicates and signature-invalid attempts — so the full notification history
 * is preserved. `payment_id` is nullable because a callback may reference an
 * unknown invoice or fail signature verification before a payment is matched.
 */
@Entity('doku_transactions')
export class DokuTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  payment_id: string;

  @ManyToOne(() => Payment, { nullable: true, eager: false })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;

  @Column({ nullable: true })
  doku_reference: string;

  // DOKU order.invoice_number echoed on the callback.
  @Column({ nullable: true })
  order_id: string;

  @Column({ type: 'int', nullable: true })
  amount_idr: number;

  @Column({ nullable: true })
  method: string;

  @Column({ type: 'timestamptz', nullable: true })
  transaction_date: Date;

  // Raw DOKU transaction status string (e.g. SUCCESS, PENDING, FAILED, EXPIRED).
  @Column({ nullable: true })
  callback_status: string;

  @Column({ type: 'jsonb' })
  raw_payload: Record<string, unknown>;

  @Column({ default: false })
  signature_valid: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'received_at' })
  received_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  reconciled_at: Date;
}
