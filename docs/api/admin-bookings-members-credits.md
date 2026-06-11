# Admin Bookings, Members & Credits

---

## Admin Bookings

Base path: `/admin/bookings`

---

## GET /admin/bookings

Returns all bookings across all members. Supports filtering.

**Auth:** Bearer token  
**Permission:** `bookings:read_all`

**Query params:**

| Param | Type | Description |
|---|---|---|
| `schedule_id` | UUID | Filter by schedule |
| `member_id` | UUID | Filter by member |
| `status` | enum | `pending_payment` \| `confirmed` \| `waitlisted` \| `cancelled` \| `completed` \| `no_show` |

**Response `200`:** Array of bookings with shallow `member` and `schedule` relations, newest first.

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
      "created_at": "...",
      "updated_at": "...",
      "member": {
        "id": "uuid",
        "first_name": "Alice",
        "last_name": "Tan",
        "email": "alice@example.com",
        "status": "active",
        "credit_balance": 8
      },
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

---

## GET /admin/bookings/:id

**Permission:** `bookings:read_all`

**Response `200`:** Single booking with `member` and `schedule` relations. **Errors:** `404`.

---

## POST /admin/bookings/:id/check-in

Marks the member as checked in for this booking.

**Permission:** `bookings:check_in`

**Request body:** None.

**Response `200`:** Updated booking with `attendance_status: "checked_in"`.

**Business rules:**
- Only `confirmed` bookings can be checked in.
- Idempotent: calling it again on an already-checked-in booking is a no-op.

**Errors:**

| Code | Reason |
|---|---|
| 400 | Booking is not `confirmed` |
| 404 | Booking not found |

---

## POST /admin/bookings/:id/no-show

Marks the booking as a no-show. Credits are **not** refunded.

**Permission:** `bookings:mark_no_show`

**Request body:** None.

**Response `200`:** Updated booking with `status: "no_show"` and `attendance_status: "no_show"`.

**Business rules:**
- Only `confirmed` bookings can be marked no-show.
- No credit is refunded — no-show forfeits the deducted credit.

---

## POST /admin/bookings/:id/cancel

Cancels any booking, bypassing the ownership check. Refund logic applies based on the cancellation window.

**Permission:** `bookings:cancel_any`

**Request body (optional):**

```json
{
  "reason": "Class cancelled by studio"
}
```

**Response `200`:** Updated booking with `status: "cancelled"`.

**Business rules:**
- Only `confirmed`, `pending_payment`, or `waitlisted` bookings can be cancelled.
- Cancellation within `BOOKING_CANCELLATION_WINDOW_HOURS` (default 12 h) before `start_time` → credit refunded.
- Cancellation after the window → credit **not** refunded.

**PowerShell sample:**

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/admin/bookings/<uuid>/check-in" `
  -Headers @{ Authorization = "Bearer $token" }
```

---

## Admin Members

Base path: `/admin/members`

---

## GET /admin/members

Returns all members. Supports free-text search and status filter.

**Auth:** Bearer token  
**Permission:** `members:read`

**Query params:**

| Param | Type | Description |
|---|---|---|
| `status` | enum | `active` \| `inactive` \| `suspended` |
| `q` | string | Case-insensitive search across linked user email, full_name, and member phone |

**Response `200`:** Array of member views, newest first.

```json
{
  "data": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "user": {
        "email": "alice@example.com",
        "full_name": "Alice Tan"
      },
      "phone": "+628123456789",
      "notes": null,
      "status": "active",
      "credit_balance": 8,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "meta": { "timestamp": "..." }
}
```

`notes` is present in admin view (used for internal staff notes). `password_hash` is never exposed.

---

## GET /admin/members/:id

**Permission:** `members:read`

**Response `200`:** Single member view with linked user email/full_name. **Errors:** `404`.

---

## POST /admin/members/:id/credit-adjustment

Manually adjusts a member's credit balance. Signed integer: positive tops up, negative deducts. Always writes an immutable `manual_adjustment` ledger entry recording the acting admin.

**Permission:** `members:credit_adjust`

**Request body:**

```json
{
  "amount": 5,
  "reason": "Complimentary credits for studio issue on 2026-06-10"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `amount` | integer | Yes | non-zero signed integer |
| `reason` | string | Yes | max 500 chars, recorded in credit_ledger |

**Response `200`:**

```json
{
  "data": {
    "member_id": "uuid",
    "amount": 5,
    "balance_after": 13,
    "ledger_id": "uuid"
  },
  "meta": { "timestamp": "..." }
}
```

**Business rules:**
- `amount` must be a non-zero integer.
- A negative adjustment that would drive the balance below 0 is rejected (`400`).
- The acting admin's user ID is recorded in the `credit_ledger.created_by` column (not exposed in member-facing views).

**Errors:**

| Code | Reason |
|---|---|
| 400 | Zero amount, non-integer, or would result in negative balance |
| 404 | Member not found |

**PowerShell sample:**

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/admin/members/<uuid>/credit-adjustment" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"amount":5,"reason":"Complimentary credits"}'
```

---

## POST /admin/members/:id/packages

Manually assigns a package to a member (front-desk sale or comp grant). Atomically creates the `member_package` row and grants the corresponding credits.

**Permission:** `packages:sell`

**Request body:**

```json
{
  "package_id": "uuid",
  "reason": "Staff comp"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `package_id` | UUID | Yes | must be an `active` package |
| `reason` | string | No | recorded on the credit_ledger entry, max 500 chars |

**Response `201`:** Created `MemberPackageView`:

```json
{
  "data": {
    "id": "uuid",
    "member_id": "uuid",
    "package_id": "uuid",
    "package": { "id": "uuid", "name": "10-Class Pack" },
    "payment_id": null,
    "start_date": "2026-06-11T11:00:00.000Z",
    "expiry_date": "2026-09-09T11:00:00.000Z",
    "credits_total": 10,
    "credits_remaining": 10,
    "status": "active",
    "created_at": "...",
    "updated_at": "..."
  },
  "meta": { "timestamp": "..." }
}
```

`payment_id` is `null` for manually assigned packages (no DOKU payment involved).

**Business rules:**
- Package must have `status = active` (not `inactive`). `is_published` is not checked — you can assign unpublished packages manually.
- Credits are granted atomically in the same DB transaction as the `member_package` insert.
- Packages with `credit_amount = 0` create the `member_package` but write no credit ledger entry.
- `validity_days` and `credit_amount` are copied from the package at assignment time.

**Errors:**

| Code | Reason |
|---|---|
| 400 | Package is not active |
| 404 | Member or package not found |

---

## Admin Waitlist

A waitlist entry is a booking row with `status: "waitlisted"` and a `waitlist_position`. Members join via `POST /member/schedules/:scheduleId/waitlist` (see [Member](./member.md#waitlist)). Admins view the queue and manually promote entries to confirmed bookings.

---

## GET /admin/schedules/:id/waitlist

Returns the waitlist queue for a schedule, ordered by `waitlist_position` ascending.

**Auth:** Bearer token  
**Permission:** `bookings:read_all`

**Path param:** `id` — schedule UUID.

**Response `200`:** Array of waitlist entries with a member summary.

```json
{
  "data": [
    {
      "id": "uuid",
      "booking_code": "BK-ABC123",
      "member": {
        "id": "uuid",
        "first_name": "Alice",
        "last_name": "Tan",
        "email": "alice@example.com"
      },
      "status": "waitlisted",
      "waitlist_position": 1,
      "credit_cost": 2,
      "created_at": "2026-06-11T10:00:00.000Z"
    }
  ],
  "meta": { "timestamp": "..." }
}
```

Returns `[]` if the schedule has no waitlist entries. Returns `404` if the schedule does not exist.

---

## POST /admin/waitlist/:id/promote

Promotes a waitlisted entry to a confirmed booking. This is the only way a waitlist entry becomes a booking — there is **no automatic promotion** when a confirmed booking is cancelled (planned for a later iteration).

**Auth:** Bearer token  
**Permission:** `bookings:update`

**Path param:** `id` — the waitlist entry (booking) ID.

**Request body:** None.

**Response `200`:** The promoted entry, now `status: "confirmed"`.

```json
{
  "data": {
    "id": "uuid",
    "booking_code": "BK-ABC123",
    "schedule_id": "uuid",
    "status": "confirmed",
    "waitlist_position": 1,
    "credit_cost": 2,
    "created_at": "2026-06-11T10:00:00.000Z",
    "schedule": {
      "id": "uuid",
      "start_time": "2026-06-15T09:00:00.000Z",
      "end_time": "2026-06-15T10:00:00.000Z",
      "status": "published"
    }
  },
  "meta": { "timestamp": "..." }
}
```

**Business rules:**
- **Capacity required:** the schedule's confirmed count must be below `capacity`, checked atomically under a row lock. If the schedule is full, returns `409`.
- **Credit required:** the member must have enough `credit_balance` to cover the entry's snapshotted `credit_cost`. If not, returns `400` and nothing is changed.
- **On success:** the entry's status changes from `waitlisted` to `confirmed`, credit is debited (a `booking_debit` credit ledger entry is written), and the booking is linked to that ledger entry — exactly like a normal booking. A `credit_cost` of `0` (free class) confirms without any debit.
- The schedule must still be `published`, `is_published = true`, and not yet started.

**Errors:**

| Code | Reason |
|---|---|
| 400 | Member has insufficient credit, or schedule not published / already started |
| 404 | Waitlist entry or schedule not found |
| 409 | Schedule is full, or the entry is not on the waitlist (e.g. already promoted) |

**PowerShell sample:**

```powershell
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3001/admin/waitlist/<uuid>/promote" `
  -Headers @{ Authorization = "Bearer $token" }
```

---

## FE integration notes

- **Member detail page:** combine data from `GET /admin/members/:id`, `GET /admin/member-packages?member_id=<uuid>`, and `GET /admin/bookings?member_id=<uuid>` to build a full member profile view.
- **Check-in flow:** call `POST /admin/bookings/:id/check-in`. The endpoint is idempotent — safe to call again if the request is retried.
- **No-show vs cancel:** no-show never refunds credits; admin cancel may refund depending on timing. Show the refund eligibility deadline (`start_time - BOOKING_CANCELLATION_WINDOW_HOURS`) in the cancel confirmation dialog.
- **Credit adjustment audit:** the `reason` field is mandatory — prompt staff to provide a meaningful reason. It appears in the credit ledger.
- **Package assignment:** `payment_id: null` distinguishes manually assigned packages from DOKU-purchased ones. Use this to differentiate on the member profile UI.
- **Waitlist:** show `GET /admin/schedules/:id/waitlist` on the schedule detail page. Enable a "Promote" action only when the schedule has a free seat (a confirmed booking was cancelled or capacity was raised). Promotion debits the member's credit, so warn staff if the member's balance is low — the call returns `400` rather than promoting if credit is insufficient. There is no automatic promotion on cancellation yet, so staff must promote manually.
