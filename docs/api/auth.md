# Auth

Base path: `/auth`

All auth endpoints are **public** (no JWT required).

---

## POST /auth/register

Creates a new user account and returns a JWT. Every self-registered user receives the `member` role automatically.

**Auth:** None

**Request body:**

```json
{
  "email": "alice@example.com",
  "password": "supersecret",
  "full_name": "Alice Tan",
  "phone": "+628123456789"
}
```

| Field | Type | Required | Constraint |
|---|---|---|---|
| `email` | string | Yes | valid email, unique |
| `password` | string | Yes | min 8 chars |
| `full_name` | string | Yes | — |
| `phone` | string | No | — |

**Response `201`:**

```json
{
  "data": {
    "access_token": "<JWT>",
    "user": {
      "id": "uuid",
      "email": "alice@example.com",
      "full_name": "Alice Tan",
      "phone": "+628123456789",
      "status": "active",
      "role_id": "uuid",
      "role": { "id": "uuid", "name": "member" },
      "created_at": "2026-06-11T10:00:00.000Z",
      "updated_at": "2026-06-11T10:00:00.000Z"
    },
    "soft_launch": {
      "enabled": true,
      "active": false,
      "eligible": true,
      "participant_code": "KLAB-SL-7H3KQ9",
      "allocated_at": "2026-09-18T04:12:00.000Z",
      "quota_full": false
    }
  },
  "meta": { "timestamp": "..." }
}
```

`password_hash` is never included in any response.

`soft_launch` reports the new user's soft-launch state (see [Soft Launch](./soft-launch.md)). While the allocation period is open and quota remains, a participant code is allocated automatically. When the quota is full, registration still succeeds with `eligible: false, quota_full: true`.

**Errors:**

| Code | Reason |
|---|---|
| 409 | Email already registered |
| 500 | RBAC seed not run (`npm run seed`) |

**PowerShell sample:**

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/auth/register" `
  -ContentType "application/json" `
  -Body '{"email":"alice@example.com","password":"supersecret","full_name":"Alice Tan"}'
```

---

## POST /auth/login

**Auth:** None

**Request body:**

```json
{
  "email": "alice@example.com",
  "password": "supersecret"
}
```

**Response `200`:** Same shape as `POST /auth/register` (including `soft_launch`).

**Errors:**

| Code | Reason |
|---|---|
| 401 | Invalid email or password (same message for both — no oracle) |
| 403 | Account status is not `active` |

**PowerShell sample:**

```powershell
$resp = Invoke-RestMethod -Method Post -Uri "http://localhost:3001/auth/login" `
  -ContentType "application/json" `
  -Body '{"email":"alice@example.com","password":"supersecret"}'
$token = $resp.data.access_token
```

---

## GET /auth/me

Returns the currently authenticated user's safe profile.

**Auth:** Bearer token

**Permission:** None (any authenticated user)

**Response `200`:**

```json
{
  "data": {
    "id": "uuid",
    "email": "alice@example.com",
    "full_name": "Alice Tan",
    "phone": "+628123456789",
    "status": "active",
    "role_id": "uuid",
    "role": { "id": "uuid", "name": "member" },
    "created_at": "2026-06-11T10:00:00.000Z",
    "updated_at": "2026-06-11T10:00:00.000Z",
    "soft_launch": {
      "enabled": true,
      "active": true,
      "eligible": true,
      "participant_code": "KLAB-SL-7H3KQ9",
      "allocated_at": "2026-09-18T04:12:00.000Z",
      "quota_full": false
    }
  },
  "meta": { "timestamp": "..." }
}
```

`soft_launch` is user-keyed, so it is available here immediately after registration — before any member row exists. `participant_code` is only ever the authenticated user's own code. See [Soft Launch](./soft-launch.md).

**PowerShell sample:**

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/auth/me" `
  -Headers @{ Authorization = "Bearer $token" }
```

---

## FE integration notes

- Store `access_token` in memory or a secure httpOnly cookie. Avoid `localStorage` for sensitive apps.
- The token payload contains `sub` (user ID), `email`, `roleId`, and `roleName` — these can be decoded client-side to gate UI elements, but **never** rely on the decoded payload for server-side authorization.
- Token expiry is `JWT_EXPIRES_IN` (default `7d`). Implement a refresh strategy or re-login on `401`.
- `GET /auth/me` is the canonical source of truth for the current user's role — use it on app load.
- Read soft-launch state (`eligible`, `participant_code`, `active`, `quota_full`) from `GET /auth/me`; never send `participant_code` back to the API.
