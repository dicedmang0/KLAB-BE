# DOKU Checkout Technical Reference

## Product

We use DOKU Checkout.

Checkout creates a DOKU-hosted payment page. The backend creates a payment request, receives a `payment.url`, and the frontend redirects or opens that URL for the customer.

## Backend Create Payment

Backend must call DOKU Checkout payment API.

Sandbox:
POST https://api-sandbox.doku.com/checkout/v1/payment

Production:
POST https://api.doku.com/checkout/v1/payment

Required headers:
- Client-Id
- Request-Id
- Request-Timestamp
- Signature

Important request fields:
- order.amount
- order.invoice_number
- order.callback_url
- order.callback_url_result
- order.auto_redirect
- payment.payment_due_date
- payment.payment_method_types
- customer.name
- customer.email
- customer.phone

Important response fields:
- response.payment.url
- response.payment.token_id
- response.payment.expired_date
- response.order.invoice_number
- response.order.amount

## Internal Flow

1. Member chooses package.
2. Backend creates internal payment with status `pending`.
3. Backend calls DOKU Checkout API.
4. Backend stores:
   - invoice_number
   - DOKU payment URL
   - DOKU token ID
   - expired date
   - request ID
5. Backend returns payment URL to frontend.
6. Frontend redirects user to DOKU Checkout page.
7. DOKU sends callback/notification to backend.
8. Backend verifies and stores callback payload.
9. If payment success:
   - update payment status to `paid`
   - create/activate member_package
   - create credit_ledger entry
10. If payment failed/expired:
   - update payment status accordingly
   - do not activate package

## Internal Payment Status Mapping

DOKU Checkout report/order status:
- Pending -> internal `pending`
- Success -> internal `paid`
- Expired -> internal `expired`

DOKU transaction status:
- PENDING -> internal `pending`
- SUCCESS -> internal `paid`
- FAILED -> internal `failed`
- EXPIRED -> internal `expired`

## Payment Methods

DOKU Checkout supports multiple method types, including:
- Virtual Account
- Credit Card
- Convenience Store
- QRIS
- E-wallet
- Paylater
- Direct Debit
- Digital Banking

Use `payment.payment_method_types` if we want to limit payment methods shown on DOKU Checkout page.

Recommended MVP payment methods:
- VIRTUAL_ACCOUNT_BCA
- VIRTUAL_ACCOUNT_BANK_MANDIRI
- VIRTUAL_ACCOUNT_BRI
- VIRTUAL_ACCOUNT_BNI
- QRIS
- EMONEY_OVO
- EMONEY_DANA
- EMONEY_SHOPEE_PAY
- CREDIT_CARD, optional

## Security Rules

1. DOKU secret key must stay in backend `.env`.
2. Frontend only receives payment URL and internal payment status.
3. Signature generation must happen in backend.
4. Callback verification must happen in backend.
5. Callback processing must be idempotent.
6. Duplicate callback must not create duplicate package or duplicate credit.

## Environment Variables

DOKU_ENV=sandbox
DOKU_CLIENT_ID=
DOKU_SECRET_KEY=
DOKU_MERCHANT_ID=
DOKU_CHECKOUT_SANDBOX_URL=https://api-sandbox.doku.com/checkout/v1/payment
DOKU_CHECKOUT_PRODUCTION_URL=https://api.doku.com/checkout/v1/payment
DOKU_CALLBACK_URL=http://localhost:3001/payments/doku/callback
DOKU_RETURN_URL=http://localhost:3002/checkout/result