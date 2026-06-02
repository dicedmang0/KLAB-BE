# PRD Per Divisi — KLAB Pilates Booking Engine
**Produk:** KLAB Pilates Booking Engine
**Stack:** Next.js + Tailwind CSS, NestJS, PostgreSQL
**Tujuan dokumen:** Membagi PRD utama menjadi acuan kerja per divisi agar setiap stream development
dapat berjalan di chat/project terpisah tanpa kehilangan konteks.

# 1. Product / PRD & Scope
## 1.1 Tujuan Divisi Product
Divisi Product bertanggung jawab memastikan scope, flow, business rule, prioritas MVP, dan
acceptance criteria tetap jelas selama development.

Product menjadi sumber kebenaran untuk pertanyaan seperti:

# 1. Fitur apa yang masuk MVP.
# 2. Bagaimana flow booking berjalan.
# 3. Bagaimana rules cancellation, waitlist, credit, dan payment bekerja.
# 4. Role apa saja yang digunakan.
# 5. Apa yang boleh ditunda setelah MVP.
# 6. Bagaimana menentukan fitur sudah selesai atau belum.

## 1.2 Product Goals
# 1. Member dapat melihat jadwal, membeli package, dan booking kelas secara online.
# 2. Admin/front desk dapat mengelola booking, check-in, cancellation, waitlist, dan payment dari
dashboard.
# 3. Owner dapat melihat ringkasan operasional studio secara real-time.
# 4. Sistem credit/package harus akurat dan tidak menyebabkan double deduction atau double
activation.
# 5. Pembayaran online melalui DOKU harus dapat mengaktifkan package secara otomatis setelah
paid.

## 1.3 User Roles

### Guest

Pengunjung website yang belum login. Dapat melihat website, class, schedule, pricing, instructor,
gallery, FAQ, dan diarahkan login/register saat ingin booking atau membeli package.

### Member

Customer yang sudah memiliki akun. Dapat membeli package, booking class, cancel booking, join
waitlist, melihat active package, remaining credit, upcoming booking, dan payment history.

### Front Desk

Staff operasional yang mengelola aktivitas harian studio seperti add booking manual, check-in, no-
show, sell package manual, member management terbatas, dan payment manual.

### Instructor

Pengajar yang dapat melihat jadwal mengajar dan daftar participant kelas yang dia ajar.

### Admin

Pengelola studio yang dapat mengatur schedule, booking, member, classes, packages, instructors,
CMS, gallery, payment, reports, dan settings sesuai permission.

### Owner

Role tertinggi dengan akses penuh ke seluruh modul, laporan, setting, payment, dan role management.

## 1.4 MVP Scope

### Must Have

# 1. Auth untuk member dan admin.
# 2. Public website basic.
# 3. Public schedule.
# 4. Member booking flow.
# 5. Admin dashboard.
# 6. Calendar and schedule management.
# 7. Booking management.
# 8. Member management.
# 9. Class type management.
# 10. Package and credit system.
# 11. Payment status.
# 12. DOKU callback baseline.
# 13. Check-in and no-show.
# 14. Cancellation rule.
# 15. Basic reports.
# 16. Settings for booking rules.

### Should Have

# 1. Waitlist.
# 2. CMS content editor.
# 3. Gallery management.
# 4. Instructor view.

# 5. Export CSV.
# 6. Audit log view.

### Could Have

# 1. PDF export.
# 2. Advanced notification.
# 3. Advanced package restriction.
# 4. Private session special flow.
# 5. Multi-branch support.

### Out of Scope MVP

# 1. Native mobile app.
# 2. Loyalty/referral program.
# 3. Advanced instructor payroll.
# 4. Advanced BI dashboard.
# 5. Full WhatsApp Business API automation.

## 1.5 Core Flow

### Member Booking With Active Credit

# 1. Member login.
# 2. Member buka schedule.
# 3. Member pilih class.
# 4. Sistem validasi active package, remaining credit, class availability, schedule conflict, dan member
status.
# 5. Jika valid, sistem membuat booking confirmed.
# 6. Sistem membuat credit ledger debit.
# 7. Member melihat booking di dashboard.

### Guest Buy Package and Book

# 1. Guest buka website.
# 2. Guest pilih class atau package.
# 3. Sistem meminta login/register.
# 4. Guest melakukan checkout.
# 5. Payment success mengaktifkan package.
# 6. Booking dibuat jika class masih available.

### Cancellation

# 1. Member/admin cancel booking.
# 2. Sistem cek cancellation window.
# 3. Jika masih valid, credit dikembalikan.
# 4. Jika late cancel, credit forfeited.
# 5. Booking status menjadi cancelled.
# 6. Jika ada waitlist, sistem menjalankan waitlist promotion.

### Waitlist

# 1. Class full.
# 2. Member join waitlist.
# 3. Status booking menjadi waitlisted.
# 4. Saat slot tersedia, sistem promote waitlist berdasarkan urutan.
# 5. Status menjadi confirmed dan credit didebit.

### Check-in and No-show

# 1. Front desk membuka Today Panel.
# 2. Front desk check-in member yang datang.
# 3. Setelah class selesai, member yang tidak hadir dapat ditandai no-show.
# 4. No-show tidak mengembalikan credit.

## 1.6 Product Acceptance Criteria
# 1. Member tidak bisa booking tanpa login.
# 2. Member tanpa active credit tidak bisa booking class berbayar.
# 3. Sistem tidak boleh overbooking.
# 4. Booking confirmed harus mengurangi available slot.
# 5. Booking waitlisted tidak mengurangi available slot.
# 6. Cancellation sebelum window mengembalikan credit.
# 7. Late cancellation tidak mengembalikan credit.
# 8. Payment paid harus mengaktifkan package.
# 9. Duplicate payment callback tidak boleh menggandakan credit.
# 10. Owner dapat melihat summary revenue, booking, member, attendance, dan pending payment.

## 1.7 Open Questions Product
# 1. Apakah single session dijual di MVP?
# 2. Apakah waitlist auto-confirm atau perlu accept dari member?
# 3. Apakah credit didebit saat booking confirmed atau saat class completed?
# 4. Apakah package bisa freeze?
# 5. Apakah cancellation rule sama untuk semua class?
# 6. Apakah instructor login masuk MVP?
# 7. Apakah WhatsApp/email notification wajib MVP?
# 8. Apakah private session perlu flow khusus?
