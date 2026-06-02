# 2. Database / ERD / PostgreSQL
## 2.1 Tujuan Divisi Database
Divisi Database bertanggung jawab mendesain struktur data yang aman, scalable, dan mendukung
booking engine secara konsisten.

Fokus utama database adalah:

# 1. Relasi data antar user, member, package, schedule, booking, credit, dan payment.
# 2. Mencegah overbooking.
# 3. Menjaga credit ledger tetap akurat.
# 4. Menyimpan payment dan DOKU transaction secara audit-friendly.
# 5. Menyediakan struktur data yang mudah dipakai untuk reports.

## 2.2 Core Entity
Database minimal perlu mencakup tabel berikut:

# 1. users
# 2. roles
# 3. permissions
# 4. role_permissions
# 5. members
# 6. instructors
# 7. rooms
# 8. class_types
# 9. schedules
# 10. bookings
# 11. packages
# 12. member_packages
# 13. credit_ledger
# 14. payments
# 15. doku_transactions
# 16. cms_pages
# 17. media_assets
# 18. settings
# 19. audit_logs

## 2.3 Key Relationships
# 1. user dapat memiliki role.
# 2. user dapat terhubung ke member atau instructor.
# 3. class_type digunakan oleh banyak schedule.
# 4. schedule memiliki satu instructor dan satu room.
# 5. booking menghubungkan member dengan schedule.
# 6. member dapat memiliki banyak member_package.
# 7. member_package berasal dari package dan payment.
# 8. credit_ledger mencatat perubahan credit member.
# 9. payment dapat terkait dengan package purchase atau booking/single session.
# 10. doku_transaction terkait dengan payment.
# 11. audit_log mencatat perubahan penting pada entity utama.

## 2.4 Important Tables Summary

users

Menyimpan akun login untuk admin, owner, front desk, instructor, dan member.

Field penting:

- id
- email
- phone
- password_hash
- full_name
- role_id
- status
- created_at
- updated_at

members

Menyimpan profil customer/member.

Field penting:

- id
- user_id
- first_name
- last_name
- email
- phone
- notes
- status
- created_at
- updated_at

class_types

Master data jenis kelas.

Field penting:

- id
- name
- category
- level
- duration_minutes
- description
- default_capacity
- default_price_idr
- credit_cost
- image_url

- is_published
- status

schedules

Jadwal kelas aktual.

Field penting:

- id
- class_type_id
- instructor_id
- room_id
- start_time
- end_time
- capacity
- status
- is_published
- recurrence_rule
- created_by

bookings

Data booking member ke schedule.

Field penting:

- id
- booking_code
- member_id
- schedule_id
- status
- attendance_status
- source
- credit_ledger_id
- payment_id
- waitlist_position
- created_at
- cancelled_at

packages

Master data paket.

Field penting:

- id
- name
- description
- price_idr
- credit_amount

- is_unlimited
- validity_days
- status
- is_published

member_packages

Paket yang dimiliki member.

Field penting:

- id
- member_id
- package_id
- payment_id
- start_date
- expiry_date
- credits_total
- credits_remaining
- status

credit_ledger

Riwayat credit masuk dan keluar.

Field penting:

- id
- member_id
- member_package_id
- booking_id
- type
- amount
- balance_after
- reason
- created_by
- created_at

payments

Data pembayaran.

Field penting:

- id
- payment_code
- member_id
- package_id
- amount_idr
- method
- gateway

- status
- external_reference
- paid_at
- expired_at

doku_transactions

Log transaksi dan callback DOKU.

Field penting:

- id
- payment_id
- doku_reference
- order_id
- amount_idr
- method
- transaction_date
- callback_status
- raw_payload
- signature_valid
- received_at
- reconciled_at

## 2.5 Enum yang Dibutuhkan

user_status

- active
- inactive
- suspended

schedule_status

- draft
- published
- cancelled
- completed

booking_status

- pending_payment
- confirmed
- waitlisted
- cancelled
- completed
- no_show

attendance_status

- not_checked_in
- checked_in
- no_show

payment_status

- pending
- paid
- failed
- expired
- refunded

member_package_status

- active
- expired
- depleted
- cancelled

credit_ledger_type

- package_purchase
- booking_debit
- cancellation_refund
- manual_adjustment
- expiry
- no_show_forfeit

## 2.6 Database Rules
# 1. Booking creation dan credit deduction harus berada dalam satu database transaction.
# 2. Payment callback dan package activation harus idempotent.
# 3. confirmed booking tidak boleh melebihi schedule capacity.
# 4. booking waitlisted tidak dihitung sebagai confirmed capacity.
# 5. Member tidak boleh memiliki dua booking aktif di schedule yang sama.
# 6. Room tidak boleh double-booked di waktu yang overlap.
# 7. Instructor tidak boleh double-booked di waktu yang overlap.
# 8. Manual credit adjustment wajib masuk credit_ledger dan audit_logs.

## 2.7 Index yang Disarankan
# 1. bookings(schedule_id, status)
# 2. bookings(member_id, status)
# 3. schedules(start_time, end_time)
# 4. schedules(instructor_id, start_time)
# 5. schedules(room_id, start_time)
# 6. payments(status, created_at)

# 7. payments(external_reference)
# 8. doku_transactions(doku_reference)
# 9. doku_transactions(order_id)
# 10. credit_ledger(member_id, created_at)
# 11. member_packages(member_id, status)

## 2.8 Output yang Harus Dibuat Divisi Database
# 1. ERD final.
# 2. PostgreSQL schema.
# 3. Migration files.
# 4. Seed data untuk roles, permissions, class types, packages, rooms, dan instructors.
# 5. Index and constraint strategy.
# 6. Transaction strategy untuk booking dan payment.
# 7. Data dictionary.
