# Payments & DOKU

Covers the admin read endpoints for payment records and DOKU callback audit logs, and the backend-only DOKU callback endpoint (reference for backend engineers).

---

## Admin Payments

Base path: `/admin/payments`  
**Permission for all endpoints:** `payments:read_all` (owner, admin, front_desk)

---

## GET /admin/payments

Returns a paginated list of all internal payment records.

**Auth:** Bearer token  
**Permission:** `payments:read_all`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | enum | — | `pending` \| `paid` \| `failed` \| `expired` \| `refunded` |
| `gateway` | string | — | e.g. `doku` |
| `payment_code` | string | — | Exact match (e.g. `INV-LB3K2FABC1`) |
| `q` | string | — | ILIKE search on member email, first_name, last_name |
| `from` | ISO 8601 | — | `created_at >=` |
| `to` | ISO 8601 | — | `created_at <=` |
| `page` | integer | 1 | 1-based page |
| `limit` | integer | 20 | Max 100 |

**Response `200`:**

```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "payment_code": "INV-LB3K2FABC1",
        "member": {
          "id": "uuid",
          "first_name": "Alice",
          "last_name": "Tan",
          "email": "alice@example.com"
        },
        "package": { "id": "uuid", "name": "10-Class Pack" },
        "amount_idr": 1500000,
        "method": "VIRTUAL_ACCOUNT_BCA",
        "gateway": "doku",
        "status": "paid",
        "external_reference": "tok-abc123",
        "paid_at": "2026-06-11T11:31:18.000Z",
        "expired_at": "2026-06-11T12:31:18.000Z",
        "created_at": "2026-06-11T10:00:00.000Z",
        "updated_at": "2026-06-11T11:31:18.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  },
  "meta": { "timestamp": "..." }
}
```

`checkout_url` is not included in the list — use the detail endpoint.

**PowerShell sample:**

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/admin/payments?status=paid&limit=10" `
  -Headers @{ Authorization = "Bearer $token" }
```

---

## GET /admin/payments/:id

Returns full detail for a single payment, including the checkout URL.

**Permission:** `payments:read_all`

**Response `200`:**

```json
{
  "data": {
    "id": "uuid",
    "payment_code": "INV-LB3K2FABC1",
    "member": {
      "id": "uuid",
      "first_name": "Alice",
      "last_name": "Tan",
      "email": "alice@example.com"
    },
    "package": { "id": "uuid", "name": "10-Class Pack" },
    "amount_idr": 1500000,
    "method": "VIRTUAL_ACCOUNT_BCA",
    "gateway": "doku",
    "status": "paid",
    "external_reference": "tok-abc123",
    "checkout_url": "https://staging.doku.com/checkout-link-v2/<token>",
    "paid_at": "2026-06-11T11:31:18.000Z",
    "expired_at": "2026-06-11T12:31:18.000Z",
    "created_at": "2026-06-11T10:00:00.000Z",
    "updated_at": "2026-06-11T11:31:18.000Z"
  },
  "meta": { "timestamp": "..." }
}
```

**Errors:** `404` if payment not found.

---

## GET /admin/payments/:id/doku-transactions

Returns all DOKU callback records for a specific payment. Useful for diagnosing why a payment did not activate.

**Permission:** `payments:read_all`

**Response `200`:** Array of `DokuTransactionView` objects (no `raw_payload`), newest first.

```json
{
  "data": [
    {
      "id": "uuid",
      "payment_id": "uuid",
      "order_id": "INV-LB3K2FABC1",
      "doku_reference": "ref-xyz",
      "callback_status": "SUCCESS",
      "signature_valid": true,
      "amount_idr": 1500000,
      "method": "VIRTUAL_ACCOUNT_BCA",
      "transaction_date": "2026-06-11T11:31:00.000Z",
      "received_at": "2026-06-11T11:31:05.000Z",
      "reconciled_at": "2026-06-11T11:31:06.000Z"
    }
  ],
  "meta": { "timestamp": "..." }
}
```

An **empty array** means the payment exists but no DOKU callbacks have arrived yet.  
A `404` means the payment ID does not exist.

---

## Admin DOKU Transactions

Base path: `/admin/doku-transactions`  
**Permission for all endpoints:** `doku_transactions:read` (owner, admin only — not front_desk)

---

## GET /admin/doku-transactions

Returns a paginated list of all DOKU callback audit records. Every callback received is stored here — including invalid-signature attempts and duplicates.

**Auth:** Bearer token  
**Permission:** `doku_transactions:read`

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `callback_status` | string | — | Exact match: `SUCCESS`, `FAILED`, `PENDING`, `EXPIRED` |
| `signature_valid` | boolean | — | `true` or `false` |
| `order_id` | string | — | Exact match on DOKU order/invoice number |
| `from` | ISO 8601 | — | `received_at >=` |
| `to` | ISO 8601 | — | `received_at <=` |
| `page` | integer | 1 | 1-based page |
| `limit` | integer | 50 | Max 100 |

**Response `200`:**

```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "payment_id": "uuid",
        "order_id": "INV-LB3K2FABC1",
        "doku_reference": "ref-xyz",
        "callback_status": "SUCCESS",
        "signature_valid": true,
        "amount_idr": 1500000,
        "method": "VIRTUAL_ACCOUNT_BCA",
        "transaction_date": "2026-06-11T11:31:00.000Z",
        "received_at": "2026-06-11T11:31:05.000Z",
        "reconciled_at": "2026-06-11T11:31:06.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 50
  },
  "meta": { "timestamp": "..." }
}
```

`raw_payload` is **not** included in list responses. Use the detail endpoint.

**PowerShell sample:**

```powershell
# Find callbacks with invalid signatures
Invoke-RestMethod `
  -Uri "http://localhost:3001/admin/doku-transactions?signature_valid=false&limit=20" `
  -Headers @{ Authorization = "Bearer $token" }
```

---

## GET /admin/doku-transactions/:id

Returns the full audit record for a single DOKU callback, including `raw_payload`.

**Permission:** `doku_transactions:read`

**Response `200`:**

```json
{
  "data": {
    "id": "uuid",
    "payment_id": "uuid",
    "order_id": "INV-LB3K2FABC1",
    "doku_reference": "ref-xyz",
    "callback_status": "SUCCESS",
    "signature_valid": true,
    "amount_idr": 1500000,
    "method": "VIRTUAL_ACCOUNT_BCA",
    "transaction_date": "2026-06-11T11:31:00.000Z",
    "received_at": "2026-06-11T11:31:05.000Z",
    "reconciled_at": "2026-06-11T11:31:06.000Z",
    "raw_payload": {
      "order": { "invoice_number": "INV-LB3K2FABC1", "amount": 1500000 },
      "transaction": { "status": "SUCCESS", "date": "2026-06-11T11:31:00.000Z" },
      "channel": { "id": "VIRTUAL_ACCOUNT_BCA" }
    }
  },
  "meta": { "timestamp": "..." }
}
```

**Errors:** `404` if not found.

---

## DOKU Callback — Backend Reference

> **This endpoint is called by DOKU's servers, not by the frontend.** It is documented here for backend engineers and for diagnosing payment activation issues.

### POST /payments/doku/callback

Receives DOKU payment notifications. The endpoint is `@Public()` (no JWT) but validates a DOKU HMAC-SHA256 signature on every request.

**Headers sent by DOKU:**

| Header | Description |
|---|---|
| `Client-Id` | DOKU Client ID (must match `DOKU_CLIENT_ID` in `.env`) |
| `Request-Id` | DOKU request UUID |
| `Request-Timestamp` | ISO 8601 timestamp |
| `Signature` | HMAC-SHA256 signature — verified by `DokuSignatureService` |

**Request body (example SUCCESS notification):**

```json
{
  "order": {
    "invoice_number": "INV-LB3K2FABC1",
    "amount": 1500000
  },
  "transaction": {
    "status": "SUCCESS",
    "date": "2026-06-11T11:31:00.000Z",
    "original_request_id": "req-uuid"
  },
  "channel": {
    "id": "VIRTUAL_ACCOUNT_BCA"
  }
}
```

**Response `200`:**

```json
{
  "data": {
    "received": true,
    "payment_status": "paid",
    "activated": true
  },
  "meta": { "timestamp": "..." }
}
```

**Processing logic (for reference):**

1. Signature is verified using HMAC-SHA256 over `Client-Id`, `Request-Id`, `Request-Timestamp`, `Request-Target`, and a SHA-256 digest of the request body.
2. The raw callback body is **always** stored in `doku_transactions.raw_payload` (audit), regardless of signature validity.
3. If signature is invalid → `401 Unauthorized`. Package is **not** activated.
4. `order.invoice_number` is matched against `payments.payment_code` to locate the internal payment.
5. If `transaction.status = SUCCESS` → `activatePaidPayment` is called (atomic transaction):
   - The payment row is locked FOR UPDATE.
   - If `payment.status` is already `paid` → no-op (idempotent duplicate callback).
   - If `payment.status` is not `pending` → ignored (prevents activating after failure/expiry).
   - `amount` from the callback is compared to the stored `payment.amount_idr` — mismatch throws `400`.
   - `member_package` is created and credits are granted.
   - `payment.status` is set to `paid`.
6. If `transaction.status = FAILED` or `EXPIRED` → payment status is flipped, no activation.
7. `reconciled_at` is set on the `doku_transactions` row after processing.

**DOKU status → internal status mapping:**

| DOKU `transaction.status` | Internal `payment.status` |
|---|---|
| `SUCCESS` | `paid` |
| `PENDING` | `pending` (no change) |
| `FAILED` | `failed` |
| `EXPIRED` | `expired` |

---

## Diagnosing missed activations

If a member reports they paid but their package was not activated:

1. `GET /admin/payments?payment_code=<INV-...>` — find the internal payment, check its `status`.
2. `GET /admin/payments/:id/doku-transactions` — check if any callback arrived.
   - **Empty array:** DOKU never sent a callback. Check `DOKU_CALLBACK_URL` in `.env` and ngrok/tunnel configuration.
   - **`signature_valid: false`:** callback arrived but was rejected. Check `DOKU_CLIENT_ID` and `DOKU_SECRET_KEY` in `.env` match the DOKU portal credentials.
   - **`callback_status: SUCCESS` but `payment.status` still `pending`:** inspect `raw_payload` via `GET /admin/doku-transactions/:id` to see the exact fields DOKU sent. The parser reads `order.invoice_number`, `transaction.status`, and `order.amount` — if these fields are nested differently in the payload, the callback was not matched.
3. `GET /admin/doku-transactions/:id` — inspect `raw_payload` for the exact notification shape.

---

## FE integration notes

- **Never** call `POST /payments/doku/callback` from the frontend. It is a server-to-server endpoint.
- **Never** expose `DOKU_SECRET_KEY` to the frontend or log it anywhere.
- The checkout flow for the member is: call `POST /member/packages/:packageId/checkout` → redirect to `checkout_url` → wait for the return URL → poll `GET /member/packages/my` until the new package appears.
- The admin payment list (`GET /admin/payments`) is suitable for a revenue/payments table in the admin dashboard.
- For transaction-level debugging, `GET /admin/doku-transactions?signature_valid=false` quickly surfaces failed signature callbacks.
