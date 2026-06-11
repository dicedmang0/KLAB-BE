# Admin Schedules & Member Packages (Admin View)

---

## Schedules

Base path: `/admin/schedules`

---

## GET /admin/schedules

Returns all schedules (all statuses, published and unpublished).

**Auth:** Bearer token  
**Permission:** `schedules:read`

**Response `200`:** Array of schedule objects.

```json
{
  "data": [
    {
      "id": "uuid",
      "class_type_id": "uuid",
      "instructor_id": "uuid",
      "room_id": "uuid",
      "start_time": "2026-06-15T09:00:00.000Z",
      "end_time": "2026-06-15T10:00:00.000Z",
      "capacity": 12,
      "status": "published",
      "is_published": true,
      "recurrence_rule": null,
      "created_by": "uuid",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "meta": { "timestamp": "..." }
}
```

Relations are not eagerly loaded here — only IDs. Use `GET /admin/schedules/:id` for full detail.

---

## GET /admin/schedules/:id

**Permission:** `schedules:read`

**Response `200`:** Single schedule. **Errors:** `404`.

---

## POST /admin/schedules

Creates a new schedule. The `created_by` field is automatically set to the authenticated user's ID.

**Permission:** `schedules:create`

**Request body:**

```json
{
  "class_type_id": "uuid",
  "instructor_id": "uuid",
  "room_id": "uuid",
  "start_time": "2026-06-15T09:00:00.000Z",
  "end_time": "2026-06-15T10:00:00.000Z",
  "capacity": 12,
  "status": "published",
  "is_published": true,
  "recurrence_rule": null
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `class_type_id` | UUID | Yes | must exist |
| `instructor_id` | UUID | Yes | must exist |
| `room_id` | UUID | Yes | must exist |
| `start_time` | ISO 8601 datetime | Yes | — |
| `end_time` | ISO 8601 datetime | Yes | must be after `start_time` |
| `capacity` | integer | Yes | min 1 |
| `status` | enum | No | `draft` \| `published` \| `cancelled` \| `completed` |
| `is_published` | boolean | No | default false |
| `recurrence_rule` | string | No | freeform note (not auto-expanded) |

**Response `201`:** Created schedule object.

**Business rules:**
- Members can only book schedules that are `status: published` **and** `is_published: true`.
- Double-booking of a room or instructor at overlapping times is not currently enforced at the API layer — avoid it at the data entry level.

**PowerShell sample:**

```powershell
$body = @{
  class_type_id  = "<uuid>"
  instructor_id  = "<uuid>"
  room_id        = "<uuid>"
  start_time     = "2026-06-15T09:00:00.000Z"
  end_time       = "2026-06-15T10:00:00.000Z"
  capacity       = 12
  is_published   = $true
  status         = "published"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://localhost:3001/admin/schedules" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" -Body $body
```

---

## PATCH /admin/schedules/:id

Updates a schedule. All body fields are optional.

**Permission:** `schedules:update`

**Response `200`:** Updated schedule object. **Errors:** `404`.

---

## DELETE /admin/schedules/:id

Cancels the schedule (sets `status = cancelled`). Does not hard-delete. Existing bookings are **not** automatically cancelled — handle that separately if required.

**Permission:** `schedules:cancel`

**Response `200`:** Updated schedule with `status: "cancelled"`.

---

## GET /admin/schedules/:id/waitlist

Returns the waitlist queue for a schedule (members who joined the waitlist when it was full), ordered by `waitlist_position`.

**Permission:** `bookings:read_all`

This endpoint and the related `POST /admin/waitlist/:id/promote` are documented in full under [Admin Bookings, Members & Credits → Admin Waitlist](./admin-bookings-members-credits.md#admin-waitlist), since promotion is a booking + credit operation.

---

## Member Packages (Admin View)

Base path: `/admin/member-packages`

Admin read-only access to all member package grants. For granting a package to a member see `POST /admin/members/:id/packages` in [Admin Bookings, Members & Credits](./admin-bookings-members-credits.md).

---

## GET /admin/member-packages

Returns all member packages across all members. Supports filtering by `member_id` and `status`.

**Permission:** `members:read`

**Query params:**

| Param | Type | Description |
|---|---|---|
| `member_id` | UUID | Filter to one member's packages |
| `status` | enum | `active` \| `expired` \| `depleted` \| `cancelled` |

**Response `200`:** Array of member package views, newest first.

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
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "meta": { "timestamp": "..." }
}
```

---

## GET /admin/member-packages/:id

**Permission:** `members:read`

**Response `200`:** Single member package. **Errors:** `404`.

---

## FE integration notes

- Use `GET /admin/member-packages?member_id=<uuid>` on the member detail page to show that member's package history.
- `payment_id` links to the payment that funded this package (if purchased via DOKU checkout). It will be `null` for manually assigned packages.
- `credits_remaining` decrements with each booking. If `credits_remaining === 0` the status moves to `depleted`.
- To grant a package manually (comp or front-desk sale), use `POST /admin/members/:id/packages` — this does **not** require a payment.
