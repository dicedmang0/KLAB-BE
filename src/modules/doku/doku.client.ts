import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DokuSignatureService } from './doku-signature.service';

export interface CreateCheckoutParams {
  invoiceNumber: string;
  amountIdr: number;
  requestId: string;
  customer: { name: string; email?: string; phone?: string };
  paymentDueMinutes?: number;
}

export interface CreateCheckoutResult {
  paymentUrl: string;
  tokenId: string | null;
  expiredDate: string | null;
  raw: Record<string, unknown>;
}

const DEFAULT_DUE_MINUTES = 60;

/**
 * Wraps the DOKU Checkout create-payment API. In `DOKU_MOCK=true` mode it returns
 * a synthetic response without any network call, so the checkout flow is fully
 * exercisable locally. Production/sandbox use real credentials + signed requests.
 */
@Injectable()
export class DokuClient {
  private readonly logger = new Logger(DokuClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly signature: DokuSignatureService,
  ) {}

  async createCheckoutPayment(params: CreateCheckoutParams): Promise<CreateCheckoutResult> {
    const mock = this.config.get<boolean>('doku.mock');
    const dueMinutes = params.paymentDueMinutes ?? DEFAULT_DUE_MINUTES;

    if (mock) {
      return this.mockResult(params, dueMinutes);
    }

    const clientId = this.config.get<string>('doku.clientId') ?? '';
    const checkoutUrl = this.config.get<string>('doku.checkoutUrl') as string;
    const checkoutPath = this.config.get<string>('doku.checkoutPath') as string;
    const callbackUrl = this.config.get<string>('doku.callbackUrl') as string;
    const returnUrl = this.config.get<string>('doku.returnUrl') as string;

    if (!clientId || !(this.config.get<string>('doku.secretKey') ?? '')) {
      throw new BadGatewayException('DOKU credentials are not configured');
    }

    const requestTimestamp = this.signature.timestamp();
    const body = {
      order: {
        amount: params.amountIdr,
        invoice_number: params.invoiceNumber,
        currency: 'IDR',
        callback_url: callbackUrl,
        callback_url_result: returnUrl,
        auto_redirect: true,
      },
      payment: {
        payment_due_date: dueMinutes,
      },
      customer: {
        name: params.customer.name,
        email: params.customer.email,
        phone: params.customer.phone,
      },
    };
    const rawBody = JSON.stringify(body);

    const headers = {
      clientId,
      requestId: params.requestId,
      requestTimestamp,
    };
    const signatureValue = this.signature.sign(headers, checkoutPath, rawBody);

    try {
      const res = await fetch(checkoutUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': clientId,
          'Request-Id': params.requestId,
          'Request-Timestamp': requestTimestamp,
          Signature: signatureValue,
        },
        body: rawBody,
        signal: AbortSignal.timeout(15000),
      });

      const json = (await res.json()) as Record<string, any>;
      if (!res.ok) {
        this.logger.error(`DOKU checkout failed (${res.status}): ${JSON.stringify(json)}`);
        throw new BadGatewayException('DOKU checkout request failed');
      }

      const payment = (json.payment ?? {}) as Record<string, any>;
      const url = payment.url;
      if (!url) {
        throw new BadGatewayException('DOKU response did not include a payment URL');
      }
      return {
        paymentUrl: url,
        tokenId: payment.token_id ?? null,
        expiredDate: payment.expired_date ?? null,
        raw: json,
      };
    } catch (e) {
      if (e instanceof BadGatewayException) throw e;
      this.logger.error(`DOKU checkout request error: ${(e as Error).message}`);
      throw new BadGatewayException('Could not reach DOKU checkout');
    }
  }

  private mockResult(params: CreateCheckoutParams, dueMinutes: number): CreateCheckoutResult {
    const returnUrl = this.config.get<string>('doku.returnUrl') as string;
    const tokenId = `mock-${randomUUID()}`;
    const expiredDate = new Date(Date.now() + dueMinutes * 60 * 1000).toISOString();
    const paymentUrl = `${returnUrl}?mock=1&invoice=${encodeURIComponent(params.invoiceNumber)}&token=${tokenId}`;
    this.logger.warn(
      `DOKU_MOCK active — returning synthetic checkout URL for ${params.invoiceNumber}`,
    );
    return {
      paymentUrl,
      tokenId,
      expiredDate,
      raw: { mock: true, invoice_number: params.invoiceNumber, amount: params.amountIdr },
    };
  }
}
