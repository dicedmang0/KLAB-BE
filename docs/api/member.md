# Member

All endpoints require a valid JWT with the `member` role (or any role that holds the relevant permission).

---

## GET /member/me

Returns the authenticated member's own safe profile.

**Auth:** Bearer token  
**Permission:** `users:read_own`

**Response `200`:**

```json
{
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "first_name": "Alice",
    "last_name": "Tan",
    "email": "alice@example.com",
    "phone": "+628123456789",
    "status": "active",
    "credit_balance": 8
  },
  "meta": { "timestamp": "..." }
}
```

`notes` and internal fields are never exposed.

---

## GET /member/credits

Returns the authenticated member's credit balance and last 50 ledger entries, newest first.

**Auth:** Bearer token  
**Permission:** `payments:read_own`

**Response `200`:**

```json
{
  "data": {
    "credit_balance": 8,
    "ledger": [
      {
        "id": "uuid",
        "type": "booking_debit",
        "amount": -2,
        "balance_after": 8,
        "reason": "Booking BK-ABC123",
        "member_package_id": null,
        "booking_id": "uuid",
        "created_at": "2026-06-11T09:00:00.000Z"
      },
      {
        "id": "uuid",
        "type": "package_purchase",
        "amount": 10,
        "balance_after": 10,
        "reason": "Package purchase: 10-Class Pack (INV-XYZ)",
        "member_package_id": "uuid",
        "booking_id": null,
        "created_at": "2026-06-10T08:00:00.000Z"
      }
    ]
  },
  "meta": { "timestamp": "..." }
}
```

`created_by` (admin user ID for manual adjustments) is deliberately stripped from this view.

**Note:** If the user has no member row yet, returns `{ credit_balance: 0, ledger: [] }`.

---

## GET /member/bookings

Returns all bookings for the authenticated member.

**Auth:** Bearer token  
**Permission:** `bookings:read_own`

**Response `200`:** Array of bookings with a shallow `schedule` relation:

```json
{
  "data": [
    {
      "id": "uuid",
      "booking_code": "BK-ABC123",
      "member_id": "uuid",
      "schedule_id": "uuid",
      "status": "confirmed",
      "attendance_status": "not_checked_in",
      "source": "member",
      "credit_cost": 2,
      "credit_ledger_id": "uuid",
      "cancelled_at": null,
      "created_at": "2026-06-11T09:00:00.000Z",
      "updated_at": "2026-06-11T09:00:00.000Z",
      "schedule": {
        "id": "uuid",
        "start_time": "2026-06-15T09:00:00.000Z",
        "end_time": "2026-06-15T10:00:00.000Z",
        "status": "published"
      }
    }
  ],
  "meta": { "timestamp": "..." }
}
```

Sorted newest first. Returns `[]` if the user has no member row yet.

---

## GET /member/bookings/:id

Returns a single booking with full schedule relations (class type, instructor, room).

**Auth:** Bearer token  
**Permission:** `bookings:read_own`

**Ownership:** The booking must belong to the authenticated member. A booking that exists but belongs to a different member returns `404` (not `403`) to prevent enumeration.

**Response `200`:** Same as list item but with full nested relations:

```json
{
  "data": {
    "id": "uuid",
    "booking_code": "BK-ABC123",
    "status": "confirmed",
    "attendance_status": "not_checked_in",
    "source": "member",
    "credit_cost": 2,
    "cancelled_at": null,
    "created_at": "...",
    "updated_at": "...",
    "schedule": {
      "id": "uuid",
      "start_time": "2026-06-15T09:00:00.000Z",
      "end_time": "2026-06-15T10:00:00.000Z",
      "capacity": 12,
      "status": "published",
      "class_type": { "id": "uuid", "name": "Reformer Pilates", "duration_minutes": 60 },
      "instructor": { "id": "uuid", "first_name": "Sari", "last_name": "Dewi" },
      "room": { "id": "uuid", "name": "Studio A" }
    }
  },
  "meta": { "timestamp": "..." }
}
```

---

## POST /member/bookings

Creates a confirmed booking for the authenticated member and debits credits atomically.

**Auth:** Bearer token  
**Permission:** `bookings:create`

**Request body:**

```json
{
  "schedule_id": "uuid"
}
```

**Response `201`:** The newly created booking (same shape as `GET /member/bookings/:id`).

**Business rules:**
1. Member must be `active`.
2. Schedule must be `published` and `is_published = true`.
3. Schedule must not have started yet.
4. Confirmed booking count must be below `schedule.capacity` (checked atomically under a row lock — no overbooking possible).
5. Member must have enough `credit_balance` to cover the class type's `credit_cost`. A `credit_cost` of `0` means the class is free (no credit deducted).
6. One active booking per member per schedule (unique constraint enforced at DB level).

**Errors:**

| Code | Reason |
|---|---|
| 400 | Schedule not bookable, started, or insufficient credit |
| 403 | Member account not active |
| 404 | Schedule not found |
| 409 | Schedule full or duplicate booking |

**PowerShell sample:**

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/member/bookings" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"schedule_id":"<uuid>"}'
```

---

## POST /member/bookings/:id/cancel

Cancels the authenticated member's own booking. Refunds credit only if within the cancellation window.

**Auth:** Bearer token  
**Permission:** `bookings:cancel_own`

**Request body (optional):**

```json
{
  "reason": "Cannot attend"
}
```

**Response `200`:** Updated booking with `status: "cancelled"` and `cancelled_at` set.

**Business rules:**
- Only `confirmed`, `pending_payment`, or `waitlisted` bookings can be cancelled.
- Cancellation within `BOOKING_CANCELLATION_WINDOW_HOURS` (default 12 h) before `start_time` → credit is refunded.
- Cancellation after the window → credit is **not** refunded (late cancellation forfeiture).
- No-show bookings cannot be retroactively cancelled.

---

## GET /member/packages/my

Returns all member packages (active and historical) owned by the authenticated member.

**Auth:** Bearer token  
**Permission:** `packages:read`

**Response `200`:**

```json
{
  "data": [
    {
      "id": "uuid",
      "member_id": "uuid",
      "package_id": "uuid",
      "package": { "id": "uuid", "name": "10-Class Pack" },
      "payment_id": "uuid",
      "start_date": "2026-06-10T08:00:00.000Z",
      "expiry_date": "2026-09-08T08:00:00.000Z",
      "credits_total": 10,
      "credits_remaining": 8,
      "status": "active",
      "created_at": "2026-06-10T08:00:00.000Z",
      "updated_at": "2026-06-11T09:00:00.000Z"
    }
  ],
  "meta": { "timestamp": "..." }
}
```

Returns `[]` if the user has no member row or no packages yet.

---

## POST /member/packages/:packageId/checkout

Initiates a DOKU Checkout payment for a package. Creates an internal `pending` payment record, calls DOKU, and returns the DOKU-hosted payment URL for the frontend to redirect to.

**Auth:** Bearer token  
**Permission:** `packages:read`

**Path param:** `packageId` — UUID of the package to purchase.

**Request body:** None.

**Response `201`:**

```json
{
  "data": {
    "payment_id": "uuid",
    "payment_code": "INV-LB3K2FABC1",
    "amount_idr": 1500000,
    "status": "pending",
    "checkout_url": "https://staging.doku.com/checkout-link-v2/<token>",
    "expired_at": "2026-06-11T12:31:18.000Z"
  },
  "meta": { "timestamp": "..." }
}
```

**FE flow:**
1. Call this endpoint.
2. Redirect the user to `checkout_url` (or open it in a new tab).
3. DOKU handles the payment UI and method selection.
4. After payment, DOKU redirects the user to `DOKU_RETURN_URL` (configured in `.env`).
5. DOKU sends a server-to-server callback to `POST /payments/doku/callback` (backend only — not called by FE).
6. The backend verifies the callback, activates the package, and adds credits.
7. FE should poll `GET /member/packages/my` or `GET /member/credits` to confirm activation.

**Business rules:**
- Package must be `active` and `is_published = true`.
- Internal payment is stored **before** calling DOKU (audit trail preserved even on DOKU failure).
- The `checkout_url` expires at `expired_at`. After expiry, a new checkout must be initiated.
- **Never** show `DOKU_SECRET_KEY` or any DOKU header secrets to the frontend.

**Errors:**

| Code | Reason |
|---|---|
| 400 | Package not available for purchase |
| 404 | Package not found |
| 502 | DOKU checkout call failed |

---

## POST /member/packages/:packageId/purchase-intent

Returns a purchase preview for a package without creating any payment record. Use this to show the member a confirmation screen before redirecting to checkout.

**Auth:** Bearer token  
**Permission:** `packages:read`

**Response `200`:**

```json
{
  "data": {
    "member_id": "uuid",
    "package_id": "uuid",
    "name": "10-Class Pack",
    "description": "10 credits, valid for 90 days.",
    "amount_idr": 1500000,
    "credit_amount": 10,
    "is_unlimited": false,
    "validity_days": 90,
    "status": "intent",
    "payment_required": true,
    "message": "..."
  },
  "meta": { "timestamp": "..." }
}
```

Nothing is persisted. Use this to build a checkout confirmation screen, then call `POST /member/packages/:packageId/checkout` when the member confirms.

---

## FE integration notes

- **Credit display:** always read `credit_balance` from `GET /member/me` or `GET /member/credits`. Do not maintain a local counter.
- **Booking gate:** check `available_slots` from `/public/schedules` before showing the book button, but the backend is the authoritative gate at booking time.
- **Checkout flow:** call `/checkout` → redirect to `checkout_url` → after return URL lands, poll `/member/packages/my` until the new package appears with `status: active`. Do not assume the package is activated immediately on return — there may be a brief delay while the DOKU callback is processed.
- **Cancellation window:** show the cancellation deadline to the member as `start_time - BOOKING_CANCELLATION_WINDOW_HOURS` (default 12 h). After this point the credit is forfeit.
