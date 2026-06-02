# 3. Backend / NestJS API
## 3.1 Tujuan Divisi Backend
Divisi Backend bertanggung jawab membangun API, business logic, authorization, payment
integration, dan data consistency.

Backend harus memastikan:

# 1. Booking tidak overbooked.
# 2. Credit tidak double deduct atau double refund.
# 3. Payment callback aman dan idempotent.
# 4. Role permission berjalan benar.
# 5. Admin dashboard dan report mendapat data valid.

## 3.2 NestJS Module Structure
Module yang perlu dibuat:

# 1. AuthModule
# 2. UsersModule
# 3. RolesModule
# 4. MembersModule
# 5. InstructorsModule
# 6. RoomsModule
# 7. ClassTypesModule
# 8. SchedulesModule
# 9. BookingsModule
# 10. WaitlistModule

# 11. PackagesModule
# 12. MemberPackagesModule
# 13. CreditsModule
# 14. PaymentsModule
# 15. DokuModule
# 16. ReportsModule
# 17. CmsModule
# 18. MediaModule
# 19. SettingsModule
# 20. AuditLogsModule
# 21. NotificationsModule

## 3.3 API Group

### Auth

- POST /auth/register
- POST /auth/login
- POST /auth/logout
- POST /auth/forgot-password
- POST /auth/reset-password
- GET /auth/me

### Public

- GET /public/home
- GET /public/classes
- GET /public/schedules
- GET /public/packages
- GET /public/instructors
- GET /public/gallery
- GET /public/faq

### Member

- GET /member/dashboard
- GET /member/bookings
- POST /member/bookings
- POST /member/bookings/:id/cancel
- GET /member/packages
- GET /member/payments
- PATCH /member/profile

### Admin Dashboard

- GET /admin/dashboard/summary
- GET /admin/dashboard/today
- GET /admin/dashboard/arrivals

### Admin Schedules

- GET /admin/schedules
- POST /admin/schedules
- GET /admin/schedules/:id
- PATCH /admin/schedules/:id
- POST /admin/schedules/:id/cancel
- POST /admin/schedules/block-time

### Admin Bookings

- GET /admin/bookings
- POST /admin/bookings
- GET /admin/bookings/:id
- PATCH /admin/bookings/:id
- POST /admin/bookings/:id/check-in
- POST /admin/bookings/:id/cancel
- POST /admin/bookings/:id/no-show

### Admin Members

- GET /admin/members
- POST /admin/members
- GET /admin/members/:id
- PATCH /admin/members/:id
- GET /admin/members/:id/bookings
- GET /admin/members/:id/packages
- POST /admin/members/:id/credit-adjustment

### Admin Classes

- GET /admin/class-types
- POST /admin/class-types
- GET /admin/class-types/:id
- PATCH /admin/class-types/:id
- DELETE /admin/class-types/:id

### Admin Packages

- GET /admin/packages
- POST /admin/packages
- GET /admin/packages/:id
- PATCH /admin/packages/:id
- DELETE /admin/packages/:id
- POST /admin/members/:id/sell-package

### Admin Payments

- GET /admin/payments
- POST /admin/payments/manual
- GET /admin/payments/:id
- POST /payments/create
- POST /payments/doku/callback

- GET /payments/result

### Admin DOKU

- GET /admin/doku-transactions
- GET /admin/doku-transactions/:id
- POST /admin/doku-transactions/:id/retry-sync

### Reports

- GET /admin/reports/revenue
- GET /admin/reports/attendance
- GET /admin/reports/classes
- GET /admin/reports/instructors
- GET /admin/reports/export

### CMS and Media

- GET /admin/cms
- PATCH /admin/cms/:slug
- GET /admin/media
- POST /admin/media
- PATCH /admin/media/:id
- DELETE /admin/media/:id

### Settings

- GET /admin/settings
- PATCH /admin/settings/studio-profile
- PATCH /admin/settings/booking-rules
- PATCH /admin/settings/doku
- GET /admin/settings/roles
- PATCH /admin/settings/roles/:id

## 3.4 Critical Business Logic

### Booking Creation

Backend harus:

# 1. Validasi member active.
# 2. Validasi schedule published.
# 3. Validasi schedule belum lewat.
# 4. Validasi slot available.
# 5. Validasi active member package dan credit.
# 6. Validasi tidak ada duplicate booking untuk schedule sama.
# 7. Buat booking confirmed.
# 8. Debit credit ledger.
# 9. Commit transaction.

### Waitlist Creation

Backend harus:

# 1. Validasi class full.
# 2. Validasi setting allow_waitlist aktif.
# 3. Validasi member belum ada waitlist/booking di schedule tersebut.
# 4. Buat booking waitlisted.
# 5. Tentukan waitlist_position.

### Cancellation

Backend harus:

# 1. Validasi booking dapat dibatalkan.
# 2. Cek cancellation window.
# 3. Refund credit jika valid.
# 4. Tidak refund credit jika late cancellation.
# 5. Update booking status.
# 6. Trigger waitlist promotion.
# 7. Tulis audit log.

### Payment Callback

Backend harus:

# 1. Terima callback DOKU.
# 2. Simpan raw payload.
# 3. Validasi signature jika tersedia.
# 4. Cari payment berdasarkan reference/order id.
# 5. Cegah duplicate processing.
# 6. Update payment status.
# 7. Jika paid, aktifkan package dan credit.
# 8. Tulis doku_transactions.

## 3.5 Backend Acceptance Criteria
# 1. Semua protected endpoint memakai auth guard.
# 2. Permission guard berjalan sesuai role.
# 3. Booking dan credit update atomic.
# 4. Duplicate DOKU callback aman.
# 5. Error response konsisten.
# 6. Input tervalidasi dengan DTO.
# 7. Admin action penting masuk audit log.
# 8. Report hanya menghitung data yang valid sesuai status.

## 3.6 Output yang Harus Dibuat Divisi Backend
# 1. API contract final.
# 2. NestJS module skeleton.
# 3. DTO per endpoint.
# 4. Service logic per module.
# 5. Auth and RBAC implementation.
# 6. Booking transaction service.
# 7. Credit ledger service.
# 8. DOKU callback service.
# 9. Report aggregation service.
# 10. Error response standard.
