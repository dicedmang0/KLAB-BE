import { registerAs } from '@nestjs/config';

/**
 * DOKU Checkout configuration. Secrets come from the gitignored `.env` only —
 * never from a committed file. `mock` short-circuits the outbound network call
 * for local smoke testing (default false; production must use real credentials).
 */
function pathOf(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  try {
    return new URL(url).pathname;
  } catch {
    return fallback;
  }
}

export default registerAs('doku', () => {
  const env = process.env.DOKU_ENV ?? 'sandbox';
  const checkoutUrl =
    env === 'production'
      ? (process.env.DOKU_CHECKOUT_PRODUCTION_URL ?? 'https://api.doku.com/checkout/v1/payment')
      : (process.env.DOKU_CHECKOUT_SANDBOX_URL ??
        'https://api-sandbox.doku.com/checkout/v1/payment');

  const callbackUrl =
    process.env.DOKU_CALLBACK_URL ?? 'http://localhost:3001/payments/doku/callback';

  return {
    env,
    clientId: process.env.DOKU_CLIENT_ID ?? '',
    secretKey: process.env.DOKU_SECRET_KEY ?? '',
    merchantId: process.env.DOKU_MERCHANT_ID ?? '',
    checkoutUrl,
    // Request-Target used in the signature component string for the outbound call.
    checkoutPath: pathOf(checkoutUrl, '/checkout/v1/payment'),
    callbackUrl,
    // Request-Target DOKU uses when signing the notification it sends us.
    callbackPath: pathOf(callbackUrl, '/payments/doku/callback'),
    returnUrl: process.env.DOKU_RETURN_URL ?? 'http://localhost:3002/checkout/result',
    mock: (process.env.DOKU_MOCK ?? 'false').toLowerCase() === 'true',
    // Local-only: gate temporary masked debug logging for the outbound checkout request.
    debugLogging: (process.env.DOKU_DEBUG_LOGGING ?? 'false').toLowerCase() === 'true',
  };
});
