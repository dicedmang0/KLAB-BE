# 6. Rekomendasi Pembagian Chat
Agar pengerjaan tetap rapi, gunakan chat terpisah berikut:

### Chat 1 — KLAB Booking Engine: Product & PRD
Gunakan untuk:

- Perubahan scope.
- Business rule.
- Flow booking.
- Prioritas MVP.
- Keputusan product.

Prompt awal yang bisa dipakai:

"Chat, kita lanjut dari PRD Per Divisi KLAB Booking Engine. Saya ingin membahas Product & Scope.
Gunakan bagian Product sebagai acuan."

### Chat 2 — KLAB Booking Engine: Database & ERD
Gunakan untuk:

- ERD.
- PostgreSQL schema.
- Migration.
- Index.
- Constraint.
- Credit ledger.
- Payment schema.

Prompt awal yang bisa dipakai:

"Chat, kita lanjut dari PRD Per Divisi KLAB Booking Engine. Sekarang fokus ke Database & ERD. Buatkan
ERD dan schema PostgreSQL lengkap sesuai acuan database."

### Chat 3 — KLAB Booking Engine: Backend NestJS
Gunakan untuk:

- API contract.
- NestJS module.
- DTO.
- Service logic.
- Booking logic.
- Credit logic.

- DOKU callback.
- RBAC.

Prompt awal yang bisa dipakai:

"Chat, kita lanjut dari PRD Per Divisi KLAB Booking Engine. Sekarang fokus ke Backend NestJS. Buatkan
API contract dan module structure sesuai acuan backend."

### Chat 4 — KLAB Booking Engine: Frontend Next.js
Gunakan untuk:

- Next.js route.
- Tailwind setup.
- Component breakdown.
- Admin dashboard migration.
- Public website.
- Member booking flow.
- API integration.

Prompt awal yang bisa dipakai:

"Chat, kita lanjut dari PRD Per Divisi KLAB Booking Engine. Sekarang fokus ke Frontend Next.js +
Tailwind CSS. Buatkan route map dan component breakdown dari UI admin yang sudah ada."

### Chat 5 — KLAB Booking Engine: QA & Deployment
Gunakan untuk:

- QA scenario.
- Test case.
- Deployment checklist.
- Environment setup.
- Staging/production release.
- DOKU sandbox/live readiness.

Prompt awal yang bisa dipakai:

"Chat, kita lanjut dari PRD Per Divisi KLAB Booking Engine. Sekarang fokus ke QA & Deployment.
Buatkan test case dan release checklist berdasarkan acuan QA."

# 7. Urutan Pengerjaan yang Disarankan
# 1. Product finalization.
# 2. Database ERD and schema.
# 3. Backend API contract.

# 4. Frontend route and component breakdown.
# 5. Backend foundation.
# 6. Frontend foundation.
# 7. Booking and credit core.
# 8. Payment and DOKU.
# 9. Reports and CMS.
# 10. QA and production deployment.

# 8. Catatan Penting
PRD per divisi ini tidak menggantikan PRD master, tetapi menjadi dokumen operasional agar setiap
divisi dapat bekerja dengan konteks yang lebih fokus.

Jika ada perubahan business rule dari Product, perubahan tersebut harus disinkronkan ke Database,
Backend, Frontend, dan QA karena booking engine memiliki keterkaitan kuat antara flow, schema, API,
UI, dan test case.
