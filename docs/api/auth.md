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
    }
  },
  "meta": { "timestamp": "..." }
}
```

`password_hash` is never included in any response.

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

**Response `200`:** Same shape as `POST /auth/register`.

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
    "updated_at": "2026-06-11T10:00:00.000Z"
  },
  "meta": { "timestamp": "..." }
}
```

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
