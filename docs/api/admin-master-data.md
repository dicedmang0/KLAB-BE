# Admin Master Data

Covers Rooms, Instructors, Class Types, Packages, and Users (read-only).

All endpoints require a valid JWT. The minimum permission required is shown per endpoint.

---

## Rooms — `GET /admin/rooms`

**Permission:** `rooms:read` (admin, front_desk, instructor, owner)

**Response `200`:** Array of all rooms.

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Studio A",
      "description": "Main reformer studio, 12 machines.",
      "capacity": 12,
      "status": "active",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "meta": { "timestamp": "..." }
}
```

---

## GET /admin/rooms/:id

**Permission:** `rooms:read`

**Response `200`:** Single room object. **Errors:** `404` if not found.

---

## POST /admin/rooms

**Permission:** `rooms:create`

**Request body:**

```json
{
  "name": "Studio B",
  "description": "Matwork studio.",
  "capacity": 16,
  "status": "active"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | non-empty |
| `description` | string | No | — |
| `capacity` | integer | Yes | min 1 |
| `status` | enum | No | `active` \| `inactive`, default `active` |

**Response `201`:** Created room object.

---

## PATCH /admin/rooms/:id

**Permission:** `rooms:update`

**Request body:** All fields optional (same fields as POST). Only provided fields are updated.

**Response `200`:** Updated room object.

---

## DELETE /admin/rooms/:id

Deactivates the room (sets `status = inactive`). Does not hard-delete.

**Permission:** `rooms:delete`

**Response `200`:** Updated room with `status: "inactive"`.

**PowerShell sample:**

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/admin/rooms" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"name":"Studio A","capacity":12}'
```

---

## Instructors — `GET /admin/instructors`

**Permission:** `instructors:read`

**Response `200`:** Array of instructors.

```json
{
  "data": [
    {
      "id": "uuid",
      "first_name": "Sari",
      "last_name": "Dewi",
      "email": "sari@klab.id",
      "phone": "+628111222333",
      "bio": "Certified Pilates instructor.",
      "specialization": "Reformer",
      "user_id": null,
      "status": "active",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "meta": { "timestamp": "..." }
}
```

---

## GET /admin/instructors/:id

**Permission:** `instructors:read`. **Errors:** `404`.

---

## POST /admin/instructors

**Permission:** `instructors:create`

**Request body:**

```json
{
  "first_name": "Sari",
  "last_name": "Dewi",
  "email": "sari@klab.id",
  "phone": "+628111222333",
  "bio": "Certified Pilates instructor.",
  "specialization": "Reformer",
  "user_id": null,
  "status": "active"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `first_name` | string | Yes | — |
| `last_name` | string | Yes | — |
| `email` | string | Yes | valid email |
| `phone` | string | No | — |
| `bio` | string | No | — |
| `specialization` | string | No | — |
| `user_id` | UUID | No | links to a login account |
| `status` | enum | No | `active` \| `inactive` |

**Response `201`:** Created instructor object.

---

## PATCH /admin/instructors/:id

**Permission:** `instructors:update`. All body fields optional.

---

## DELETE /admin/instructors/:id

Deactivates the instructor. **Permission:** `instructors:delete`. **Response `200`:** Updated object.

---

## Class Types — `GET /admin/class-types`

**Permission:** `class_types:read`

**Response `200`:** Array of all class types (published and unpublished).

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Reformer Pilates",
      "category": "Pilates",
      "level": "All Levels",
      "duration_minutes": 60,
      "description": "Full-body reformer class.",
      "default_capacity": 12,
      "default_price_idr": 150000,
      "credit_cost": 2,
      "image_url": "https://cdn.example.com/reformer.jpg",
      "is_published": true,
      "status": "active",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "meta": { "timestamp": "..." }
}
```

---

## GET /admin/class-types/:id

**Permission:** `class_types:read`. **Errors:** `404`.

---

## POST /admin/class-types

**Permission:** `class_types:create`

**Request body:**

```json
{
  "name": "Reformer Pilates",
  "category": "Pilates",
  "level": "All Levels",
  "duration_minutes": 60,
  "description": "Full-body reformer class.",
  "default_capacity": 12,
  "default_price_idr": 150000,
  "credit_cost": 2,
  "image_url": "https://cdn.example.com/reformer.jpg",
  "is_published": false,
  "status": "active"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | — |
| `duration_minutes` | integer | Yes | min 1 |
| `default_capacity` | integer | Yes | min 1 |
| `category` | string | No | — |
| `level` | string | No | — |
| `description` | string | No | — |
| `default_price_idr` | integer | No | min 0 |
| `credit_cost` | integer | No | min 0, default 0 |
| `image_url` | string | No | — |
| `is_published` | boolean | No | default false |
| `status` | enum | No | `active` \| `inactive` |

**Response `201`:** Created class type object.

---

## PATCH /admin/class-types/:id

**Permission:** `class_types:update`. All body fields optional.

---

## DELETE /admin/class-types/:id

Deactivates the class type. **Permission:** `class_types:delete`.

---

## Packages — `GET /admin/packages`

**Permission:** `packages:read` (admin, front_desk, owner, member — note: member uses this permission for the public catalogue)

**Response `200`:** Array of all packages (published and unpublished, all statuses).

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
      "validity_days": 90,
      "is_published": true,
      "status": "active",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "meta": { "timestamp": "..." }
}
```

---

## GET /admin/packages/:id

**Permission:** `packages:read`. **Errors:** `404`.

---

## POST /admin/packages

**Permission:** `packages:create`

**Request body:**

```json
{
  "name": "10-Class Pack",
  "description": "10 credits, valid for 90 days.",
  "price_idr": 1500000,
  "credit_amount": 10,
  "is_unlimited": false,
  "validity_days": 90,
  "is_published": false,
  "status": "active"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | Yes | — |
| `price_idr` | integer | Yes | min 0 |
| `credit_amount` | integer | Yes | min 0, set 0 for unlimited |
| `is_unlimited` | boolean | Yes | if true, credits are informational |
| `validity_days` | integer | Yes | min 1 |
| `description` | string | No | — |
| `is_published` | boolean | No | default false |
| `status` | enum | No | `active` \| `inactive` |

**Response `201`:** Created package object.

---

## PATCH /admin/packages/:id

**Permission:** `packages:update`. All body fields optional.

---

## DELETE /admin/packages/:id

Deactivates the package. **Permission:** `packages:delete`.

---

## Admin Users — `GET /admin/users`

Read-only user listing for owner/admin roles.

**Auth:** Bearer token  
**Role:** `owner` or `admin` (checked by `@Roles()`, not by permission string)

**Response `200`:** Array of users with role relation. `password_hash` never included.

```json
{
  "data": [
    {
      "id": "uuid",
      "email": "admin@klab.id",
      "full_name": "Admin User",
      "phone": null,
      "status": "active",
      "role_id": "uuid",
      "role": { "id": "uuid", "name": "admin" },
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "meta": { "timestamp": "..." }
}
```

---

## GET /admin/users/:id

**Role:** `owner` or `admin`. **Errors:** `404`.

---

## FE integration notes

- Admin CRUD endpoints (`POST`, `PATCH`, `DELETE`) follow the same pattern across all master data entities: create returns `201`, update/deactivate returns `200`, not found returns `404`.
- `DELETE` is always a soft-delete (deactivation), never a hard delete. Deactivated records remain in the database and can be reactivated via `PATCH`.
- `is_published` on class types and packages controls visibility in `/public` endpoints. Set it to `false` to hide from members while editing.
- For the FE admin package catalogue, use `GET /admin/packages` (shows all). For member-facing pages use `GET /public/packages` (published only).
