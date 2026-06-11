import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

export interface DokuSignatureHeaders {
  clientId: string;
  requestId: string;
  requestTimestamp: string;
}

/**
 * Implements the DOKU Checkout (Jokul) HMAC-SHA256 signature scheme, used both
 * to sign our outbound create-payment request and to verify inbound callbacks.
 *
 *   Digest    = Base64(SHA256(rawBody))                         // omitted if no body
 *   Component = "Client-Id:<id>\nRequest-Id:<id>\n
 *                Request-Timestamp:<ts>\nRequest-Target:<path>\nDigest:<digest>"
 *   Signature = "HMACSHA256=" + Base64(HMAC_SHA256(Component, secretKey))
 *
 * The secret key never leaves the backend.
 */
@Injectable()
export class DokuSignatureService {
  constructor(private readonly config: ConfigService) {}

  private get secretKey(): string {
    return this.config.get<string>('doku.secretKey') ?? '';
  }

  /** Base64(SHA256(body)) over the exact bytes that will be / were transmitted. */
  digest(rawBody: Buffer | string): string {
    return createHash('sha256').update(rawBody).digest('base64');
  }

  /** ISO-8601 UTC timestamp without milliseconds, as DOKU expects. */
  timestamp(date: Date = new Date()): string {
    return date.toISOString().split('.')[0] + 'Z';
  }

  private componentString(
    headers: DokuSignatureHeaders,
    requestTarget: string,
    digest: string,
  ): string {
    return [
      `Client-Id:${headers.clientId}`,
      `Request-Id:${headers.requestId}`,
      `Request-Timestamp:${headers.requestTimestamp}`,
      `Request-Target:${requestTarget}`,
      `Digest:${digest}`,
    ].join('\n');
  }

  /** Produces the full `HMACSHA256=<base64>` signature value. */
  sign(headers: DokuSignatureHeaders, requestTarget: string, rawBody: Buffer | string): string {
    const digest = this.digest(rawBody);
    const component = this.componentString(headers, requestTarget, digest);
    const hmac = createHmac('sha256', this.secretKey).update(component).digest('base64');
    return `HMACSHA256=${hmac}`;
  }

  /**
   * Verifies a callback signature against the raw request body. Returns false
   * (never throws) on any mismatch, missing header, or unconfigured secret —
   * the caller decides how to respond.
   */
  verify(
    headers: DokuSignatureHeaders,
    requestTarget: string,
    rawBody: Buffer | string,
    providedSignature: string | undefined,
  ): boolean {
    if (!providedSignature || !this.secretKey || !headers.clientId || !headers.requestTimestamp) {
      return false;
    }
    const expected = this.sign(headers, requestTarget, rawBody);
    const a = Buffer.from(expected);
    const b = Buffer.from(providedSignature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
