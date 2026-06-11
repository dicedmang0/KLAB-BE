# DOKU Checkout — Sandbox End-to-End Runbook

How to verify the full DOKU Checkout flow against the **real DOKU sandbox**:
create a payment → pay on the DOKU-hosted page → receive the server-to-server
notification → activate `member_package` + `credit_ledger`.

The application code is unchanged for this — sandbox vs. mock is purely `.env`
driven (`DOKU_MOCK`). Nothing here exposes or commits secrets; the real
`DOKU_CLIENT_ID` / `DOKU_SECRET_KEY` live only in the gitignored `.env`.

---

## 1. Required `.env` values

Set these in your local **`.env`** (gitignored — never in `.env.example`):

| Variable | Sandbox value | Notes |
|---|---|---|
| `DOKU_MOCK` | `false` | The switch. `true` short-circuits the network call and returns a mock URL. **Restart the server after changing this.** |
| `DOKU_ENV` | `sandbox` | Selects `DOKU_CHECKOUT_SANDBOX_URL`. |
| `DOKU_CLIENT_ID` | *your sandbox Client-Id* | From DOKU Back Office. |
| `DOKU_SECRET_KEY` | *your sandbox Secret Key* | Used only inside the backend to sign requests / verify callbacks. |
| `DOKU_CHECKOUT_SANDBOX_URL` | `https://api-sandbox.doku.com/checkout/v1/payment` | Create-payment endpoint. |
| `DOKU_CALLBACK_URL` | `https://<ngrok>/payments/doku/callback` | Sent as `order.callback_url`. Use a **public https** URL for E2E (see §2). |
| `DOKU_RETURN_URL` | `https://<ngrok>/checkout/result` or your FE result page | `order.callback_url_result` — where the customer's browser returns after paying. |
| `DOKU_MERCHANT_ID` | optional | Not used by the create-payment call. |

> The signature `Request-Target` for the callback is derived from
> `DOKU_CALLBACK_URL`'s path (`/payments/doku/callback`). If you change the path,
> keep the DOKU dashboard Notification URL and this value on the same path.

After editing `.env`, **restart** `npm run start:dev` so the new values load.

---

## 2. ngrok setup (public callback URL)

DOKU's create-payment call is outbound, so it works from `localhost`. But the
**server-to-server payment notification** is DOKU → your backend, and DOKU cannot
reach `http://localhost`. Expose the backend with a tunnel:

```bash
# Backend runs on port 3001
ngrok http 3001
```

ngrok prints a public HTTPS URL, e.g. `https://a1b2c3d4.ngrok-free.app`.
Your callback endpoint is then:

```
https://a1b2c3d4.ngrok-free.app/payments/doku/callback
```

Use that base in `DOKU_CALLBACK_URL` (and optionally `DOKU_RETURN_URL`), then
restart the server.

---

## 3. DOKU dashboard Notification URL

In real DOKU sandbox, the server-to-server notification is delivered to the
**Notification URL configured in the DOKU Back Office**, not inferred from the
request. Configure it once:

1. Log in to the DOKU sandbox Back Office.
2. Go to **Integration → Notification / Payment Notification** (naming varies by
   account).
3. Set the **Notification URL** (a.k.a. HTTP Notification / Webhook) to:
   ```
   https://<ngrok>/payments/doku/callback
   ```
4. Save. Ensure the credentials shown there match the `DOKU_CLIENT_ID` /
   `DOKU_SECRET_KEY` in your `.env` (same sandbox app).

DOKU signs that notification with the same HMAC-SHA256 scheme the backend
verifies (`Request-Target` = `/payments/doku/callback`). A signature mismatch →
`401` and **no activation** (the raw payload is still stored for audit).

---

## 4. Checkout test steps

From the repo root, with Postgres up, migrations run, seeds applied, and the
server restarted with `DOKU_MOCK=false`:

```powershell
# 1. Start infra + API (separate terminals)
docker compose up -d
npm run migration:run
npm run seed
npm run start:dev          # must be restarted AFTER setting DOKU_MOCK=false

# 2. Drive a real sandbox checkout
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-doku-sandbox-checkout.ps1
```

The script:
- registers a throwaway test member **with email + phone** (so DOKU's `customer`
  payload is complete);
- promotes a throwaway owner and creates a **published, active** package;
- calls `POST /member/packages/:packageId/checkout`;
- **fails loudly** if the server is still in mock mode (a `mock=1` checkout URL);
- on success prints only safe values: `payment_id`, `payment_code`, `amount`,
  `expired_at`, `checkout_url`, and the manual next steps.

It passes as soon as DOKU returns a real `checkout_url` — it does **not** wait for
payment completion.

Then, manually:
1. Open the printed `checkout_url` in a browser.
2. Pay with a DOKU **sandbox** method (sandbox Virtual Account number or the DOKU
   payment simulator). No real money moves in sandbox.
3. DOKU sends the notification to your ngrok Notification URL → the backend
   verifies the signature and activates the package.

---

## 5. Post-payment verification

After paying, check every artifact tied to the `payment_code`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-doku-payment.ps1 -PaymentCode INV-XXXXXXXX
```

Expected after a successful paid callback:

| Artifact | Expected |
|---|---|
| `payments.status` | `paid` (`paid_at`, `method`, `external_reference` populated) |
| `doku_transactions` | ≥ 1 row for the order, `signature_valid = t`, `reconciled_at` set |
| `member_packages` | exactly **1** row for `payment_id`, `status = active`, credits = package credit_amount |
| `credit_ledger` | exactly **1** `package_purchase` row, `amount` = credit_amount |
| `members.credit_balance` | increased by the package's `credit_amount` |

### Raw SQL (equivalent, if you prefer psql directly)

```sql
-- payment
SELECT id, payment_code, status, amount_idr, method, external_reference, paid_at
FROM payments WHERE payment_code = 'INV-XXXXXXXX';

-- callbacks (audit log; one row per callback received)
SELECT id, callback_status, signature_valid, amount_idr, method, received_at, reconciled_at
FROM doku_transactions WHERE order_id = 'INV-XXXXXXXX' ORDER BY received_at;

-- activated member_package
SELECT mp.id, mp.status, mp.credits_total, mp.credits_remaining, mp.start_date, mp.expiry_date
FROM member_packages mp JOIN payments p ON mp.payment_id = p.id
WHERE p.payment_code = 'INV-XXXXXXXX';

-- package_purchase ledger entry
SELECT cl.id, cl.type, cl.amount, cl.balance_after, cl.created_at
FROM credit_ledger cl JOIN payments p ON cl.member_id = p.member_id
WHERE p.payment_code = 'INV-XXXXXXXX' AND cl.type = 'package_purchase';

-- member balance
SELECT m.id, m.email, m.credit_balance
FROM members m JOIN payments p ON m.id = p.member_id
WHERE p.payment_code = 'INV-XXXXXXXX';
```

### Idempotency spot-check
If DOKU re-sends the notification (or you trigger a resend from the dashboard),
re-run the verify helper: `doku_transactions` gains another row, but
`member_packages` stays **1** and `credit_ledger` `package_purchase` stays **1** —
the credit_balance does not change.

---

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Script says **"running in DOKU_MOCK mode"** | `DOKU_MOCK` is still `true`, or the server wasn't restarted after editing `.env`. Set `false` and restart. |
| `checkout` returns **HTTP 502** | DOKU rejected the create-payment. Check the server log line `DOKU checkout failed (...)` for DOKU's message. Common: wrong/mismatched `DOKU_CLIENT_ID`/`DOKU_SECRET_KEY`, `callback_url`/`return_url` not accepted (use public https), amount below the channel minimum, or missing `customer` fields. |
| 502 mentions **signature** | Client-Id and Secret Key must be a matched sandbox pair; the timestamp must be current (server clock skew can break it). |
| Paid on DOKU but **no callback** arrived | The DOKU dashboard Notification URL isn't set, points at the wrong ngrok URL, or the tunnel restarted (ngrok free URLs change per session). Re-point it and re-test. |
| Callback received but **`401` / not activated** | Signature mismatch: the Secret Key in `.env` differs from the sandbox app that sent the notification, or `Request-Target` path differs from `/payments/doku/callback`. The raw payload is still stored in `doku_transactions` (`signature_valid = f`). |
| Callback `paid` but activation **skipped** | Check `payments.status` — if it was already `paid`, that's correct idempotent behavior. If amount mismatched, the callback is rejected with `400` and not activated. |
| `customer.phone` errors from DOKU | Register the member with a phone (the sandbox script does this); a member with a null phone produces an incomplete `customer` payload. |

---

## Safety notes
- `.env` is gitignored — real `DOKU_CLIENT_ID` / `DOKU_SECRET_KEY` are never
  committed, and `.env.example` keeps placeholders only.
- The scripts print only non-sensitive values (`payment_code`, `payment_id`,
  `checkout_url`, amounts, statuses). They never echo the secret key.
- `verify-doku-payment.ps1` is read-only and uses no DOKU credentials.
