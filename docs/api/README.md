# KLAB Booking Engine — API Reference

## Base URL

| Environment | Base URL |
|---|---|
| Local | `http://localhost:3001` |
| Sandbox / Staging | configure in `.env` |

All paths below are relative to the base URL.

---

## Authentication

All endpoints except `POST /auth/register`, `POST /auth/login`, and all `GET /public/*` routes require a JWT bearer token.

```
Authorization: Bearer <access_token>
```

Obtain the token from `POST /auth/login` or `POST /auth/register`. The token is a signed JWT; its expiry is controlled by `JWT_EXPIRES_IN` (default `7d`).

---

## Response Envelope

Every response is wrapped by the global `ResponseInterceptor`:

```json
{
  "data": <endpoint payload>,
  "meta": {
    "timestamp": "2026-06-11T11:31:18.000Z"
  }
}
```

Paginated list endpoints return a nested object inside `data`:

```json
{
  "data": {
    "items": [ ... ],
    "total": 42,
    "page": 1,
    "limit": 20
  },
  "meta": { "timestamp": "..." }
}
```

Non-paginated list endpoints return a plain array inside `data`.

---

## Error Format

Errors follow the NestJS `HttpExceptionFilter` shape:

```json
{
  "statusCode": 400,
  "message": "Human-readable description",
  "error": "Bad Request",
  "timestamp": "2026-06-11T11:31:18.000Z",
  "path": "/member/bookings"
}
```

Common status codes:

| Code | Meaning |
|---|---|
| 400 | Validation error or business rule violation |
| 401 | Missing or invalid JWT / DOKU signature |
| 403 | Authenticated but insufficient permission |
| 404 | Resource not found |
| 409 | Conflict (duplicate booking, email already registered) |
| 502 | DOKU upstream failure |

---

## Permission Model

The `RolesGuard` checks `@Permissions()` metadata against the user's role in the database. Roles and their default permissions:

| Role | Key permissions |
|---|---|
| `owner` | All permissions |
| `admin` | All except `roles:update` |
| `front_desk` | Schedules read, bookings full, members read/create/update, packages read/sell, payments read |
| `instructor` | Schedules read, bookings read/check-in/no-show |
| `member` | Own bookings, own packages, own payments, public schedules |

Self-registered users via `POST /auth/register` receive the `member` role automatically.

---

## Enums

### PaymentStatus
`pending` · `paid` · `failed` · `expired` · `refunded`

### BookingStatus
`pending_payment` · `confirmed` · `waitlisted` · `cancelled` · `completed` · `no_show`

### AttendanceStatus
`not_checked_in` · `checked_in` · `no_show`

### MemberPackageStatus
`active` · `expired` · `depleted` · `cancelled`

### CreditLedgerType
`package_purchase` · `booking_debit` · `cancellation_refund` · `manual_adjustment` · `expiry` · `no_show_forfeit`

### ScheduleStatus
`draft` · `published` · `cancelled` · `completed`

### MemberStatus
`active` · `inactive` · `suspended`

### PackageStatus / ClassTypeStatus / RoomStatus / InstructorStatus
`active` · `inactive`

---

## Pagination (list endpoints that support it)

Query params accepted by `GET /admin/payments` and `GET /admin/doku-transactions`:

| Param | Type | Default | Max | Description |
|---|---|---|---|---|
| `page` | integer | 1 | — | 1-based page number |
| `limit` | integer | 20 (payments) / 50 (doku-txns) | 100 | Items per page |

---

## Section index

- [Auth](./auth.md)
- [Public](./public.md)
- [Member](./member.md)
- [Admin Master Data](./admin-master-data.md)
- [Admin Schedules](./admin-schedules.md)
- [Admin Bookings, Members & Credits](./admin-bookings-members-credits.md)
- [Payments & DOKU](./payments-doku.md)
