# Soft Launch — Participant Code Booking Access

KLAB runs a soft launch from **2026-09-20 00:00:00 WIB** to **2026-09-25 23:59:59 WIB** for a maximum of **80 unique participants**. During that window, classes that start inside the window are **exclusive to allocated participants**, who book them with **no credit requirement and no credit debit**. Everything outside the window behaves exactly as before.

All rules below are enforced by the backend. The FE only displays state.

---

## Concepts

| Term | Meaning |
|---|---|
| Participant | A `users` row that holds a `soft_launch_participants` row. Eligibility is keyed to **`users.id`** (the JWT subject), never to a members row and never to the code. |
| Participant code | `KLAB-SL-XXXXXX` — random, non-sequential, contains no user data. **Display / reference only.** The backend never accepts it as input; a copied code grants nothing. |
| Allocation period | From the moment `SOFT_LAUNCH_ENABLED=true` is deployed until `SOFT_LAUNCH_END`. Registration auto-allocates while quota remains. |
| Booking window | `SOFT_LAUNCH_START` … `SOFT_LAUNCH_END` (inclusive). Soft-launch rules apply to a booking only when **both** the submission time **and** `schedule.start_time` are inside it (Option C). |
| Quota | 80 **allocations**, not bookings. A participant may book any number of in-window classes subject to the normal capacity and one-active-booking-per-schedule rules. |

---

## Configuration

```
SOFT_LAUNCH_ENABLED=true
SOFT_LAUNCH_START=2026-09-20T00:00:00+07:00
SOFT_LAUNCH_END=2026-09-25T23:59:59+07:00
SOFT_LAUNCH_QUOTA=80
```

Dates are ISO-8601 with an explicit offset, so they are exact instants regardless of server timezone. `END` is inclusive. `START`/`END` are required when enabled; startup fails if they are missing or `START >= END`. Setting `SOFT_LAUNCH_ENABLED=false` is an instant kill switch: allocation and the gate stop, existing bookings are untouched.

---

## FE contract: the `soft_launch` block

Returned inside every authenticated identity response — `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `GET /member/me`:

```json
"soft_launch": {
  "enabled": true,
  "active": true,
  "eligible": true,
  "participant_code": "KLAB-SL-7H3KQ9",
  "allocated_at": "2026-09-18T04:12:00.000Z",
  "quota_full": false
}
```

| Field | Meaning |
|---|---|
| `enabled` | Feature flag is on. |
| `active` | Now is inside the booking window. Show the "soft launch live" state when `true`. |
| `eligible` | This user holds an allocation (regardless of window). |
| `participant_code` | The **owner's own** code, or `null`. Only ever the authenticated user's row. |
| `allocated_at` | When the slot was allocated, or `null`. |
| `quota_full` | `true` when the user is not eligible and all slots are taken (only while enabled). Show "soft launch is full" to these users. |

Use `GET /auth/me` for a freshly registered user: it is user-keyed and works before the member row exists (`GET /member/me` still returns `404` until the first booking, unchanged).

**Do not send `participant_code` in any request.** `POST /member/bookings` accepts only `schedule_id`; an extra field is rejected by validation.

---

## Registration

`POST /auth/register` is unchanged in input. After the user is created, while the allocation period is open:

- quota remaining → a slot and code are allocated automatically; the response carries `soft_launch.eligible = true` and the code.
- quota full → registration **still succeeds**; `soft_launch.eligible = false`, `quota_full = true`.

Allocation never fails registration. A user who registered but missed a slot (error, or before the feature was enabled) can be allocated by an admin (below).

Receiving a code before 20 September does **not** allow early booking — the booking window is separate.

---

## Booking (`POST /member/bookings`)

The gate runs inside the existing booking transaction, after the schedule is validated and before the credit check:

| now in window | class start in window | user allocated | Result |
|---|---|---|---|
| no | any | any | Normal flow, unchanged (credit required and debited). |
| yes | no | any | Normal flow, unchanged. |
| yes | yes | yes | **Bypass**: booking confirmed, `credit_cost: 0`, `credit_ledger_id: null`, `source: "soft_launch"`. No balance check, no debit, no ledger row. |
| yes | yes | no | **`403`** with `code: "SOFT_LAUNCH_NOT_ELIGIBLE"`. No fallback to credit booking. |

All other rules still apply in every row: member must be `active`, schedule published and not started, capacity under the schedule lock, one active booking per member per schedule.

**Error response (403):**

```json
{
  "statusCode": 403,
  "message": "This class is reserved for soft-launch participants",
  "code": "SOFT_LAUNCH_NOT_ELIGIBLE",
  "timestamp": "...",
  "path": "/member/bookings"
}
```

**Soft-launch booking (201):** same shape as any booking, with

```json
"source": "soft_launch",
"credit_cost": 0,
"credit_ledger_id": null
```

Cancelling a soft-launch booking sets `status: cancelled` and refunds nothing (nothing was charged). No-show forfeits nothing.

After `SOFT_LAUNCH_END`, `active` becomes `false`, the code stays visible for history, confirmed soft-launch bookings remain valid, and normal credit booking resumes automatically.

---

## Waitlist

- `POST /member/schedules/:scheduleId/waitlist`: for an in-window class during the window, only participants may join (`403 SOFT_LAUNCH_NOT_ELIGIBLE` otherwise). Nothing is charged on join, as before.
- `POST /admin/waitlist/:id/promote` re-evaluates the gate at promotion time. If the member is a participant and both "now" and the class start are inside the window, the promotion confirms with **no credit requirement, no debit**, `credit_cost: 0`, `source: "soft_launch"`. Otherwise the existing promotion rules apply (credit snapshot debited, `400` if insufficient). A non-participant promoted onto an in-window class during the window gets `403`.
- No automatic promotion exists; nothing changed there.

---

## Admin

### GET /admin/soft-launch/participants

**Permission:** `members:read`

```json
{
  "data": {
    "summary": {
      "enabled": true,
      "active": false,
      "start": "2026-09-19T17:00:00.000Z",
      "end": "2026-09-25T16:59:59.000Z",
      "quota": 80,
      "allocated": 42,
      "remaining": 38
    },
    "items": [
      {
        "id": "uuid",
        "code": "KLAB-SL-7H3KQ9",
        "slot_no": 1,
        "source": "registration",
        "status": "pending",
        "allocated_by": null,
        "allocated_at": "2026-09-18T04:12:00.000Z",
        "user": { "id": "uuid", "email": "alice@example.com", "full_name": "Alice Tan" },
        "member": { "id": "uuid", "first_name": "Alice", "last_name": "Tan", "status": "active" },
        "soft_launch_bookings": 2
      }
    ]
  },
  "meta": { "timestamp": "..." }
}
```

- `status`: `pending` (before START) · `active` (inside window) · `expired` (after END) · `disabled` (feature off).
- `member` is `null` until the user's member row exists (created on first booking).
- `soft_launch_bookings` counts bookings with `source = soft_launch` for that member.

### POST /admin/soft-launch/participants

Allocate a slot to an existing account. **Permission:** `members:update`

```json
{ "user_id": "uuid" }
```
or
```json
{ "email": "alice@example.com" }
```

`user_id` is canonical (works before any member row exists). Returns the participant item above.

| Code | Reason |
|---|---|
| 200 | Allocated — or already allocated (idempotent, same row returned) |
| 400 | Neither `user_id` nor `email` given |
| 404 | User not found |
| 409 | `code: SOFT_LAUNCH_QUOTA_FULL` or `code: SOFT_LAUNCH_ALLOCATION_CLOSED` (feature disabled / period ended) |

Every manual allocation records `allocated_by` and `source: "admin"` on the row — that row is the audit record.

**PowerShell:**

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/admin/soft-launch/participants" `
  -Headers @{ Authorization = "Bearer $adminToken" } `
  -ContentType "application/json" `
  -Body '{"email":"alice@example.com"}'
```

### Bookings made under soft launch

`GET /admin/bookings?source=soft_launch` (optionally `&member_id=<uuid>`).

---

## Quota integrity

`COUNT(soft_launch_participants) <= SOFT_LAUNCH_QUOTA` is guaranteed by the allocator, shared by registration and admin allocation:

1. `SELECT pg_advisory_xact_lock(<constant>)` serialises every allocation until commit.
2. Lookup by `user_id` → return existing row (idempotent).
3. `COUNT(*)` — its snapshot is taken after the lock is granted, so it sees the previous holder's commit.
4. Refuse if `count >= quota`, else insert with `slot_no = count + 1`.

DB backstops: `UNIQUE(user_id)`, `UNIQUE(code)`, `UNIQUE(slot_no)` — a non-serialised path can only fail loudly, never produce participant #81. Rows are never updated or deleted.

Verify locally: `npm run seed:soft-launch-smoke` fires 100 concurrent allocations and fails if the quota is ever exceeded.
