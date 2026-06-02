# DOKU Checkout Integration

This project uses DOKU Checkout, not Direct API.

DOKU Checkout responsibilities in Backend:
1. Create Checkout payment request to DOKU.
2. Generate DOKU request headers and signature.
3. Store internal payment as pending before redirecting user.
4. Return DOKU `payment.url` to frontend.
5. Receive payment notification/callback from DOKU.
6. Verify callback signature when required.
7. Store raw callback payload in `doku_transactions.raw_payload`.
8. Update internal payment status.
9. Activate member package and credit only after payment success.
10. Keep callback processing idempotent.

Important:
- Never expose DOKU Client ID / Secret Key to frontend.
- Never hardcode DOKU credentials.
- Use sandbox environment for development.
- Duplicate callback must not activate package twice.

Official docs:
https://developers.doku.com/accept-payments/doku-checkout