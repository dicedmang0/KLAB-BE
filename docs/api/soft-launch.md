# Soft Launch — Participant Code Booking Access

KLAB runs a soft-launch **campaign** defined entirely by environment variables: a window `SOFT_LAUNCH_START` … `SOFT_LAUNCH_END` and a quota of `SOFT_LAUNCH_QUOTA` unique participants (current production target: **2026-10-07 00:00:00 WIB** to **2026-10-11 23:59:59 WIB**, **280 participants**). During that window, classes that start inside the window are **exclusive to allocated participants**, who book them with **no credit requirement and no credit debit**. Everything outside the window behaves exactly as before.

All rules below are enforced by the backend. The FE only displays state.

---

## Concepts

| Term | Meaning |
|---|---|
| Current campaign | The window `[SOFT_LAUNCH_START, SOFT_LAUNCH_END]` (both inclusive, exact instants) from the running config. There is no campaign id: a participant row belongs to the current campaign **iff its `allocated_at` lies inside this window**. |
| Historical participant | A row whose `allocated_at` is outside the current window (e.g. from an earlier campaign). Kept in the table, but **does not count toward the quota and grants no eligibility**. |
| Participant | A `users` row that holds a **current-campaign** `soft_launch_participants` row. Eligibility is keyed to **`users.id`** (the JWT subject), never to a members row and never to the code. |
| Participant code | `KLAB-SL-XXXXXX` — random, non-sequential, contains no user data. **Display / reference only.** The backend never accepts it as input; a copied code grants nothing. |
| Allocation period | `SOFT_LAUNCH_START` … `SOFT_LAUNCH_END` (inclusive), while `SOFT_LAUNCH_ENABLED=true`. Registration auto-allocates while quota remains. Nothing is allocated before `START` (a row stamped before `START` would fall outside the campaign). |
| Booking window | `SOFT_LAUNCH_START` … `SOFT_LAUNCH_END` (inclusive). Soft-launch rules apply to a booking only when **both** the submission time **and** `schedule.start_time` are inside it (Option C). |
| Quota | `SOFT_LAUNCH_QUOTA` **allocations in the current window**, not bookings. A participant may book any number of in-window classes subject to the normal capacity and one-active-booking-per-schedule rules. |

---

## Configuration

```
SOFT_LAUNCH_ENABLED=true
SOFT_LAUNCH_START=2026-10-07T00:00:00+07:00
SOFT_LAUNCH_END=2026-10-11T23:59:59+07:00
SOFT_LAUNCH_QUOTA=280
```

Dates are ISO-8601 with an explicit offset, so they are exact instants regardless of server timezone. `END` is inclusive. `START`/`END` are required when enabled; startup fails if they are missing or `START >= END`. `SOFT_LAUNCH_QUOTA` defaults to `80` when unset — always set it explicitly. Setting `SOFT_LAUNCH_ENABLED=false` is a kill switch: allocation and the gate stop, existing bookings are untouched.

**Config is read once at startup.** Any change to these variables takes effect only after the API is **restarted / redeployed**.

---

## FE contract: the `soft_launch` block

Returned inside every authenticated identity response — `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `GET /member/me`:

```json
"soft_launch": {
  "enabled": true,
  "active": true,
  "eligible": true,
  "participant_code": "KLAB-SL-7H3KQ9",
  "allocated_at": "2026-10-07T04:12:00.000Z",
  "quota_full": false
}
```

| Field | Meaning |
|---|---|
| `enabled` | Feature flag is on. |
| `active` | Now is inside the booking window. Show the "soft launch live" state when `true`. |
| `eligible` | This user holds a **current-campaign** allocation. A historical participant is `false`. |
| `participant_code` | The **owner's own** current-campaign code, or `null` (also `null` for a historical participant). Only ever the authenticated user's row. |
| `allocated_at` | When the slot was allocated, or `null`. |
| `quota_full` | `true` when the user is not eligible and all current-campaign slots are taken (only while enabled). Show "soft launch is full" to these users. |

`GET /auth/me` is user-keyed and works for every account. `GET /member/me` also works right after registration (registration creates the member row); it returns `404` only for an older account with no member row.

**Do not send `participant_code` in any request.** `POST /member/bookings` accepts only `schedule_id`; an extra field is rejected by validation.

---

## Registration

`POST /auth/register` is unchanged in input. After the user is created, while the allocation period is open:

- quota remaining → a slot and code are allocated automatically; the response carries `soft_launch.eligible = true` and the code.
- quota full → registration **still succeeds**; `soft_launch.eligible = false`, `quota_full = true`.

Allocation never fails registration. A user who registered but missed a slot (error, or before the window opened) can be allocated by an admin (below) while the window is open. A user who already holds a historical row is not re-allocated (see [Limitations](#limitations)).

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
- Automatic promotion (seat freed by a cancellation) uses the same gate. Every path — booking, waitlist join, automatic and admin promotion — checks eligibility through the same current-campaign lookup, so a historical participant is never treated as eligible.

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
      "start": "2026-10-06T17:00:00.000Z",
      "end": "2026-10-11T16:59:59.000Z",
      "quota": 280,
      "allocated": 42,
      "remaining": 238
    },
    "items": [
      {
        "id": "uuid",
        "code": "KLAB-SL-7H3KQ9",
        "slot_no": 81,
        "source": "registration",
        "status": "pending",
        "allocated_by": null,
        "allocated_at": "2026-10-07T04:12:00.000Z",
        "user": { "id": "uuid", "email": "alice@example.com", "full_name": "Alice Tan" },
        "member": { "id": "uuid", "first_name": "Alice", "last_name": "Tan", "status": "active" },
        "soft_launch_bookings": 2
      }
    ]
  },
  "meta": { "timestamp": "..." }
}
```

- **Current campaign only.** `summary.allocated` and `summary.remaining` (`quota - allocated`, floored at 0) count rows allocated inside the current window; `items` lists only those rows. Historical rows stay in the DB but are not returned here.
- `slot_no` is a global, never-reused sequence number across all campaigns (the first participant after 80 historical rows gets `81`). It is **not** the position within the current campaign.
- `status`: `pending` (before START) · `active` (inside window) · `expired` (after END) · `disabled` (feature off).
- `member` is `null` only for an older account without a member row (registration now creates it; see [Auth](./auth.md)).
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

`user_id` is canonical (works even for an older account without a member row). Returns the participant item above.

| Code | Reason |
|---|---|
| 200 | Allocated — or already allocated (idempotent, same row returned) |
| 400 | Neither `user_id` nor `email` given |
| 404 | User not found |
| 409 | `code: SOFT_LAUNCH_QUOTA_FULL` — current-campaign quota used up |
| 409 | `code: SOFT_LAUNCH_ALLOCATION_CLOSED` — feature disabled, window not open yet, or window ended |
| 409 | `code: SOFT_LAUNCH_PREVIOUS_CAMPAIGN` — user holds a historical row and cannot be allocated again |

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

`COUNT(rows with allocated_at in [START, END]) <= SOFT_LAUNCH_QUOTA` is guaranteed by the allocator, shared by registration and admin allocation:

1. `SELECT pg_advisory_xact_lock(<constant>)` serialises every allocation until commit.
2. Lookup by `user_id` → current-campaign row: return it (idempotent); historical row: refuse (`SOFT_LAUNCH_PREVIOUS_CAMPAIGN`).
3. `COUNT(*) WHERE allocated_at BETWEEN START AND END` — its snapshot is taken after the lock is granted, so it sees the previous holder's commit.
4. Refuse if `count >= quota`, else insert with `slot_no = MAX(slot_no) + 1` over the **whole** table and a code unique across all rows.

DB backstops: `UNIQUE(user_id)`, `UNIQUE(code)`, `UNIQUE(slot_no)` — a non-serialised path can only fail loudly, never over-allocate. Rows are never updated or deleted.

Verify locally: `npm run seed:soft-launch-smoke` fires 100 concurrent allocations and fails if the quota is ever exceeded.

---

## Limitations

- **One row per user, ever.** `UNIQUE(user_id)` is global, so a user who was a participant in an earlier campaign **cannot be re-allocated** in a later one: registration skips them, admin allocation returns `409 SOFT_LAUNCH_PREVIOUS_CAMPAIGN`, and they book under normal rules. Lifting this requires a schema change (e.g. a campaign table / per-campaign uniqueness) — out of scope here.
- **Campaign membership is inferred from `allocated_at`.** Changing `SOFT_LAUNCH_START`/`END` changes which existing rows count as current. Do not move the window over rows that belong to a different campaign.
- `allocated_at` is stamped by the DB clock; an allocation in the last instant before `END` could, under app/DB clock skew, land just after `END` and not count as current.
