# 5. QA / Deployment / DevOps
## 5.1 Tujuan Divisi QA & Deployment
Divisi QA/Deployment bertanggung jawab memastikan aplikasi stabil, aman, dapat dirilis, dan
memenuhi acceptance criteria.

Fokus utama:

# 1. Test booking flow.
# 2. Test credit ledger.
# 3. Test payment callback.
# 4. Test RBAC.
# 5. Test admin operations.
# 6. Test deployment staging/production.
# 7. Test DOKU sandbox/live readiness.

## 5.2 QA Test Areas

### Auth and RBAC

# 1. Member login.
# 2. Admin login.
# 3. Front desk login.
# 4. Instructor login jika masuk scope.
# 5. Role tidak bisa akses page yang tidak diizinkan.
# 6. Expired session diarahkan login ulang.

### Booking

# 1. Member dengan credit valid bisa booking.
# 2. Member tanpa credit tidak bisa booking.
# 3. Member tidak bisa booking class yang sudah lewat.
# 4. Member tidak bisa duplicate booking di schedule sama.
# 5. Dua member booking last slot secara bersamaan.
# 6. Class full menampilkan waitlist.
# 7. Cancel sebelum cancellation window refund credit.
# 8. Cancel setelah cancellation window tidak refund credit.
# 9. Admin cancel booking.
# 10. Admin check-in member.
# 11. Admin mark no-show.

### Schedule

# 1. Admin create schedule.
# 2. Admin edit schedule.
# 3. Admin cancel schedule.
# 4. Admin create recurring schedule.
# 5. Admin block room time.
# 6. Room conflict ditolak.
# 7. Instructor conflict ditolak.
# 8. Schedule draft tidak tampil di public site.
# 9. Schedule published tampil di public site.

### Package and Credit

# 1. Package purchase menambah credit.
# 2. Booking confirmed mengurangi credit.
# 3. Cancellation valid mengembalikan credit.
# 4. No-show tidak mengembalikan credit.
# 5. Manual adjustment membutuhkan reason.
# 6. Expired package tidak dapat dipakai booking.
# 7. Depleted package tidak dapat dipakai booking.

### Payment and DOKU

# 1. Payment pending tidak mengaktifkan package.
# 2. Payment paid mengaktifkan package.
# 3. Payment failed tidak mengaktifkan package.

# 4. DOKU callback success diproses benar.
# 5. Duplicate callback tidak double credit.
# 6. Callback invalid signature ditolak/ditandai sesuai policy.
# 7. Retry sync tidak merusak data.

### Admin Dashboard

# 1. Today bookings sesuai data.
# 2. Upcoming classes sesuai schedule.
# 3. Available slots sesuai capacity dikurangi confirmed bookings.
# 4. Pending payments sesuai payment status.
# 5. Monthly revenue hanya menghitung paid payment.
# 6. Today panel hanya menampilkan data hari berjalan.

### CMS and Gallery

# 1. Admin edit CMS content.
# 2. Draft content tidak tampil public.
# 3. Published content tampil public.
# 4. Upload gallery berhasil.
# 5. Delete image membuat image tidak tampil di website.

## 5.3 Deployment Requirements
Environment yang disarankan:

# 1. Local
# 2. Development
# 3. Staging
# 4. Production

Setiap environment harus memiliki:

# 1. Database sendiri.
# 2. Environment variable sendiri.
# 3. DOKU sandbox/live config yang terpisah.
# 4. Logging.
# 5. Migration strategy.
# 6. Seed strategy.
# 7. Backup strategy untuk production database.

## 5.4 Environment Variables
Kategori env yang dibutuhkan:

### Backend

- DATABASE_URL
- JWT_SECRET

- JWT_EXPIRES_IN
- APP_ENV
- APP_URL
- API_URL
- CORS_ORIGIN
- DOKU_MERCHANT_ID
- DOKU_CLIENT_ID
- DOKU_SECRET_KEY
- DOKU_CALLBACK_URL
- DOKU_ENV
- STORAGE_PROVIDER
- STORAGE_BUCKET

### Frontend

- NEXT_PUBLIC_API_URL
- NEXT_PUBLIC_APP_URL
- NEXT_PUBLIC_DOKU_RETURN_URL

## 5.5 Release Checklist
Sebelum production release:

# 1. Migration berhasil di staging.
# 2. Seed role dan permission berhasil.
# 3. Admin owner account tersedia.
# 4. Booking happy path lulus.
# 5. Cancellation path lulus.
# 6. Waitlist path lulus jika masuk MVP.
# 7. Payment sandbox lulus.
# 8. DOKU callback lulus.
# 9. Duplicate callback test lulus.
# 10. RBAC test lulus.
# 11. Public website responsive.
# 12. Admin dashboard data benar.
# 13. Backup database production disiapkan.
# 14. Error logging aktif.
# 15. Deployment rollback plan tersedia.

## 5.6 QA Acceptance Criteria
# 1. Tidak ada critical bug pada booking, credit, payment, dan auth.
# 2. Tidak ada kasus overbooking dalam test concurrency.
# 3. Tidak ada double credit dari duplicate callback.
# 4. Role access sesuai permission matrix.
# 5. Payment paid selalu mengaktifkan package sesuai rule.
# 6. Dashboard metric sesuai database.
# 7. Public/member booking flow bisa digunakan dari mobile.
