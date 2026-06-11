# Public

Base path: `/public`

All endpoints are **public** — no JWT required. These are safe for unauthenticated visitors and the marketing website.

Only records with `status = active` **and** `is_published = true` are returned.

---

## GET /public/class-types

Returns all published class types.

**Auth:** None

**Response `200`:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Reformer Pilates",
      "category": "Pilates",
      "level": "All Levels",
      "duration_minutes": 60,
      "description": "Full-body reformer class for all fitness levels.",
      "credit_cost": 2,
      "image_url": "https://cdn.example.com/reformer.jpg"
    }
  ],
  "meta": { "timestamp": "..." }
}
```

Sorted by `name ASC`. Fields like `default_capacity`, `default_price_idr`, and internal status flags are not exposed.

---

## GET /public/class-types/:id

**Auth:** None

**Response `200`:** Single `PublicClassTypeView` (same shape as list item).

**Errors:** `404` if not found or not published.

---

## GET /public/packages

Returns all published packages available for purchase.

**Auth:** None

**Response `200`:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "10-Class Pack",
      "description": "10 credits, valid for 90 days.",
      "price_idr": 1500000,
      "credit_amount": 10,
      "is_unlimited": false,
      "validity_days": 90
    }
  ],
  "meta": { "timestamp": "..." }
}
```

Sorted by `name ASC`. `price_idr` is in full IDR (e.g. `1500000` = Rp 1.500.000).

---

## GET /public/packages/:id

**Auth:** None

**Response `200`:** Single `PublicPackageView`. **Errors:** `404` if not found or not published.

---

## GET /public/schedules

Returns all upcoming published schedules with real-time slot availability.

**Auth:** None

**Response `200`:**

```json
{
  "data": [
    {
      "id": "uuid",
      "start_time": "2026-06-15T09:00:00.000Z",
      "end_time": "2026-06-15T10:00:00.000Z",
      "capacity": 12,
      "available_slots": 5,
      "is_full": false,
      "class_type": {
        "id": "uuid",
        "name": "Reformer Pilates",
        "category": "Pilates",
        "level": "All Levels",
        "duration_minutes": 60,
        "credit_cost": 2,
        "image_url": "https://cdn.example.com/reformer.jpg"
      },
      "instructor": {
        "id": "uuid",
        "first_name": "Sari",
        "last_name": "Dewi",
        "specialization": "Reformer",
        "bio": "Certified Pilates instructor with 8 years experience."
      },
      "room": {
        "id": "uuid",
        "name": "Studio A"
      }
    }
  ],
  "meta": { "timestamp": "..." }
}
```

- Sorted by `start_time ASC`.
- `available_slots` = `capacity` minus the current confirmed booking count. Computed live on each request.
- `is_full` = `available_slots === 0`. Use this to disable the "Book" button.
- Past schedules are not filtered out here — filter by `start_time` client-side if needed.

---

## GET /public/schedules/:id

**Auth:** None

**Response `200`:** Single `PublicScheduleView`. **Errors:** `404` if not found or not published.

**PowerShell sample:**

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/public/schedules"
```

---

## FE integration notes

- Call `/public/schedules` on the class calendar page. Refresh it when the user is about to book so `available_slots` is current.
- Use `is_full` to visually differentiate full vs available slots, but do not rely on it as a hard booking gate — the backend enforces capacity atomically at booking time.
- `credit_cost` on the class type tells the member how many credits this class costs. Show it alongside `credit_balance` from `GET /member/credits` to help the member decide.
- These endpoints have no pagination — the full list is always returned. Client-side filtering by date range or class type is expected.
