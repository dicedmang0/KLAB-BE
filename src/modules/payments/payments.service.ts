import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { Package, PackageStatus } from '../packages/entities/package.entity';
import { Member } from '../members/entities/member.entity';
import {
  MemberPackage,
  MemberPackageStatus,
} from '../member-packages/entities/member-package.entity';
import { CreditLedgerType } from '../credits/entities/credit-ledger.entity';
import { CreditsService } from '../credits/credits.service';
import { MembersService } from '../members/members.service';
import { DokuClient } from '../doku/doku.client';
import { DokuSignatureService } from '../doku/doku-signature.service';
import { DokuTransactionsService } from '../doku/doku-transactions.service';

// ── Admin read-only views ─────────────────────────────────────────────────────

interface PaymentMemberSummary {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface PaymentPackageSummary {
  id: string;
  name: string;
}

export interface PaymentView {
  id: string;
  payment_code: string;
  member: PaymentMemberSummary | null;
  package: PaymentPackageSummary | null;
  amount_idr: number;
  method: string | null;
  gateway: string;
  status: PaymentStatus;
  external_reference: string | null;
  paid_at: Date | null;
  expired_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentDetailView extends PaymentView {
  checkout_url: string | null;
}

export interface PaginatedPayments {
  items: PaymentView[];
  total: number;
  page: number;
  limit: number;
}

function toPaymentView(p: Payment): PaymentView {
  return {
    id: p.id,
    payment_code: p.payment_code,
    member: p.member
      ? {
          id: p.member.id,
          first_name: p.member.first_name ?? null,
          last_name: p.member.last_name ?? null,
          email: p.member.email ?? null,
        }
      : null,
    package: p.package ? { id: p.package.id, name: p.package.name } : null,
    amount_idr: p.amount_idr,
    method: p.method ?? null,
    gateway: p.gateway,
    status: p.status,
    external_reference: p.external_reference ?? null,
    paid_at: p.paid_at ?? null,
    expired_at: p.expired_at ?? null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

function toPaymentDetailView(p: Payment): PaymentDetailView {
  return { ...toPaymentView(p), checkout_url: p.checkout_url ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface CheckoutResult {
  payment_id: string;
  payment_code: string;
  amount_idr: number;
  status: PaymentStatus;
  checkout_url: string | null;
  expired_at: Date | null;
}

export interface CallbackHeaders {
  clientId?: string;
  requestId?: string;
  requestTimestamp?: string;
  signature?: string;
}

export interface CallbackResult {
  received: true;
  payment_status: PaymentStatus | 'unknown';
  activated: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Payment)
    private readonly paymentsRepo: Repository<Payment>,
    @InjectRepository(Package)
    private readonly packagesRepo: Repository<Package>,
    private readonly creditsService: CreditsService,
    private readonly membersService: MembersService,
    private readonly dokuClient: DokuClient,
    private readonly dokuSignature: DokuSignatureService,
    private readonly dokuTransactions: DokuTransactionsService,
    private readonly config: ConfigService,
  ) {}

  // ── Checkout (creates a PENDING payment only — never activates) ────────────

  /**
   * Creates an internal pending payment, calls DOKU Checkout, stores the returned
   * payment URL/token, and returns the checkout URL to the frontend. No credit or
   * member_package is touched here — activation happens only on a verified paid
   * callback.
   */
  async createCheckout(userId: string, packageId: string): Promise<CheckoutResult> {
    const member = await this.dataSource.transaction((manager) =>
      this.membersService.ensureForUser(manager, userId),
    );

    const pkg = await this.packagesRepo.findOneBy({ id: packageId });
    if (!pkg) throw new NotFoundException(`Package ${packageId} not found`);
    if (pkg.status !== PackageStatus.ACTIVE || !pkg.is_published) {
      throw new BadRequestException('Package is not available for purchase');
    }

    const requestId = randomUUID();
    const paymentCode = this.generatePaymentCode();

    // Store internal payment as pending BEFORE calling DOKU (CLAUDE rule).
    let payment = this.paymentsRepo.create({
      payment_code: paymentCode,
      member_id: member.id,
      package_id: pkg.id,
      amount_idr: pkg.price_idr,
      gateway: 'doku',
      status: PaymentStatus.PENDING,
      request_id: requestId,
    });
    payment = await this.paymentsRepo.save(payment);

    const customerName =
      [member.first_name, member.last_name].filter(Boolean).join(' ').trim() ||
      member.email ||
      'KLAB Member';

    const doku = await this.dokuClient.createCheckoutPayment({
      invoiceNumber: paymentCode,
      amountIdr: pkg.price_idr,
      requestId,
      customer: {
        name: customerName,
        email: member.email ?? undefined,
        phone: member.phone ?? undefined,
      },
    });

    payment.checkout_url = doku.paymentUrl;
    payment.external_reference = doku.tokenId ?? undefined;
    payment.expired_at = doku.expiredDate ? new Date(doku.expiredDate) : undefined;
    payment = await this.paymentsRepo.save(payment);

    return {
      payment_id: payment.id,
      payment_code: payment.payment_code,
      amount_idr: payment.amount_idr,
      status: payment.status,
      checkout_url: payment.checkout_url ?? null,
      expired_at: payment.expired_at ?? null,
    };
  }

  // ── DOKU callback ──────────────────────────────────────────────────────────

  /**
   * Processes a DOKU notification. Always records the raw payload for audit, then:
   *  - rejects (401) without activating if the signature is invalid;
   *  - on SUCCESS, atomically activates the package + credits (idempotent);
   *  - on FAILED/EXPIRED, only flips the pending payment's status.
   */
  async handleDokuCallback(rawBody: Buffer, headers: CallbackHeaders): Promise<CallbackResult> {
    const callbackPath = this.config.get<string>('doku.callbackPath') as string;
    const signatureValid = this.dokuSignature.verify(
      {
        clientId: headers.clientId ?? '',
        requestId: headers.requestId ?? '',
        requestTimestamp: headers.requestTimestamp ?? '',
      },
      callbackPath,
      rawBody,
      headers.signature,
    );

    const body = this.parseBody(rawBody);
    const parsed = this.extractFields(body);

    // Match the payment (best-effort, for the audit FK) before storing the record.
    const payment = parsed.invoiceNumber
      ? await this.paymentsRepo.findOne({ where: { payment_code: parsed.invoiceNumber } })
      : null;

    const txn = await this.dokuTransactions.record({
      paymentId: payment?.id ?? null,
      dokuReference: parsed.dokuReference,
      orderId: parsed.invoiceNumber,
      amountIdr: parsed.amount,
      method: parsed.method,
      transactionDate: parsed.transactionDate,
      callbackStatus: parsed.dokuStatus,
      rawPayload: body,
      signatureValid,
    });

    // Invalid signature: audited above, but nothing is activated.
    if (!signatureValid) {
      this.logger.warn(
        `Rejected DOKU callback with invalid signature (order=${parsed.invoiceNumber})`,
      );
      throw new UnauthorizedException('Invalid DOKU signature');
    }

    if (!payment) {
      throw new NotFoundException(`Payment for invoice ${parsed.invoiceNumber} not found`);
    }

    const internalStatus = this.mapStatus(parsed.dokuStatus);
    let activated = false;
    let finalStatus: PaymentStatus = payment.status;

    if (internalStatus === PaymentStatus.PAID) {
      const result = await this.activatePaidPayment(
        payment.payment_code,
        parsed.amount,
        parsed.method,
      );
      activated = result.activated;
      finalStatus = PaymentStatus.PAID;
    } else if (
      internalStatus === PaymentStatus.FAILED ||
      internalStatus === PaymentStatus.EXPIRED
    ) {
      finalStatus = await this.markNonPaid(payment.payment_code, internalStatus);
    } else {
      finalStatus = payment.status; // PENDING notification — leave as-is.
    }

    await this.dokuTransactions.markReconciled(txn.id);
    return { received: true, payment_status: finalStatus, activated };
  }

  /**
   * Atomic, idempotent activation of a paid payment:
   *   lock payment → guard still-pending → lock member → create member_package →
   *   applyDelta (package_purchase ledger) → mark payment paid.
   * A duplicate paid callback finds status='paid' under the lock and no-ops; the
   * partial unique index on member_packages(payment_id) is the hard backstop.
   */
  private async activatePaidPayment(
    paymentCode: string,
    callbackAmount: number | null,
    method: string | null,
  ): Promise<{ activated: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(Payment, {
        where: { payment_code: paymentCode },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException(`Payment ${paymentCode} not found`);

      // Idempotency: already activated → no-op.
      if (payment.status === PaymentStatus.PAID) {
        return { activated: false };
      }
      // Only a still-pending payment can be activated (never re-activate a
      // failed/expired/refunded one from a late success callback).
      if (payment.status !== PaymentStatus.PENDING) {
        this.logger.warn(
          `Ignoring paid callback for payment ${paymentCode} in status ${payment.status}`,
        );
        return { activated: false };
      }

      // Amount guard — must match what we charged.
      if (callbackAmount !== null && callbackAmount !== payment.amount_idr) {
        throw new BadRequestException(
          `Callback amount ${callbackAmount} does not match payment amount ${payment.amount_idr}`,
        );
      }

      const pkg = payment.package_id
        ? await manager.findOne(Package, { where: { id: payment.package_id } })
        : null;
      if (!pkg) throw new NotFoundException(`Package ${payment.package_id} not found`);

      const member = await manager.findOne(Member, {
        where: { id: payment.member_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!member) throw new NotFoundException(`Member ${payment.member_id} not found`);

      const now = new Date();
      const expiry = new Date(now.getTime() + pkg.validity_days * MS_PER_DAY);

      const memberPackage = manager.create(MemberPackage, {
        member_id: member.id,
        package_id: pkg.id,
        payment_id: payment.id,
        start_date: now,
        expiry_date: expiry,
        credits_total: pkg.credit_amount,
        credits_remaining: pkg.credit_amount,
        status: MemberPackageStatus.ACTIVE,
      });
      const savedMp = await manager.save(MemberPackage, memberPackage);

      if (pkg.credit_amount > 0) {
        await this.creditsService.applyDelta(manager, member, pkg.credit_amount, {
          type: CreditLedgerType.PACKAGE_PURCHASE,
          reason: `Package purchase: ${pkg.name} (${payment.payment_code})`,
          memberPackageId: savedMp.id,
          createdBy: null,
        });
      }

      payment.status = PaymentStatus.PAID;
      payment.paid_at = now;
      if (method) payment.method = method;
      await manager.save(Payment, payment);

      return { activated: true };
    });
  }

  /** Flips a still-pending payment to failed/expired. Never downgrades a paid one. */
  private async markNonPaid(paymentCode: string, status: PaymentStatus): Promise<PaymentStatus> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(Payment, {
        where: { payment_code: paymentCode },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException(`Payment ${paymentCode} not found`);
      if (payment.status === PaymentStatus.PENDING) {
        payment.status = status;
        await manager.save(Payment, payment);
      }
      return payment.status;
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private parseBody(rawBody: Buffer): Record<string, unknown> {
    try {
      return JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid callback payload');
    }
  }

  /** Defensive extraction of the fields we need from a DOKU notification. */
  private extractFields(body: Record<string, any>): {
    invoiceNumber: string | null;
    amount: number | null;
    dokuStatus: string | null;
    method: string | null;
    transactionDate: Date | null;
    dokuReference: string | null;
  } {
    const order = (body.order ?? {}) as Record<string, any>;
    const transaction = (body.transaction ?? {}) as Record<string, any>;
    const channel = (body.channel ?? {}) as Record<string, any>;
    const acquirer = (body.acquirer ?? {}) as Record<string, any>;

    const amountRaw = order.amount;
    const amount =
      amountRaw === undefined || amountRaw === null ? null : parseInt(String(amountRaw), 10);

    const dateRaw = transaction.date;
    let transactionDate: Date | null = null;
    if (dateRaw) {
      const d = new Date(dateRaw);
      transactionDate = isNaN(d.getTime()) ? null : d;
    }

    return {
      invoiceNumber: order.invoice_number ?? null,
      amount: amount !== null && isNaN(amount) ? null : amount,
      dokuStatus: transaction.status ?? null,
      method: channel.id ?? acquirer.id ?? null,
      transactionDate,
      dokuReference: transaction.original_request_id ?? acquirer.id ?? null,
    };
  }

  /** DOKU transaction status → internal payment status (reference §"Mapping"). */
  private mapStatus(dokuStatus: string | null): PaymentStatus | 'unknown' {
    switch ((dokuStatus ?? '').toUpperCase()) {
      case 'SUCCESS':
        return PaymentStatus.PAID;
      case 'PENDING':
        return PaymentStatus.PENDING;
      case 'FAILED':
        return PaymentStatus.FAILED;
      case 'EXPIRED':
        return PaymentStatus.EXPIRED;
      default:
        return 'unknown';
    }
  }

  private generatePaymentCode(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `INV-${ts}${rand}`;
  }

  // ── Admin read-only queries ──────────────────────────────────────────────────

  async findAllForAdmin(filter: ListPaymentsDto): Promise<PaginatedPayments> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;

    const qb = this.paymentsRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.member', 'm')
      .leftJoinAndSelect('p.package', 'pkg')
      .orderBy('p.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (filter.status) {
      qb.andWhere('p.status = :status', { status: filter.status });
    }
    if (filter.gateway) {
      qb.andWhere('p.gateway = :gateway', { gateway: filter.gateway });
    }
    if (filter.payment_code) {
      qb.andWhere('p.payment_code = :payment_code', { payment_code: filter.payment_code });
    }
    if (filter.from) {
      qb.andWhere('p.created_at >= :from', { from: new Date(filter.from) });
    }
    if (filter.to) {
      qb.andWhere('p.created_at <= :to', { to: new Date(filter.to) });
    }
    if (filter.q) {
      qb.andWhere('(m.email ILIKE :q OR m.first_name ILIKE :q OR m.last_name ILIKE :q)', {
        q: `%${filter.q}%`,
      });
    }

    const [payments, total] = await qb.getManyAndCount();
    return { items: payments.map(toPaymentView), total, page, limit };
  }

  async findByIdForAdmin(id: string): Promise<PaymentDetailView> {
    const payment = await this.paymentsRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.member', 'm')
      .leftJoinAndSelect('p.package', 'pkg')
      .where('p.id = :id', { id })
      .getOne();
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    return toPaymentDetailView(payment);
  }
}
