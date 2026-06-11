<#
  Smoke test for Bookings + Credits Core (KLAB BE).

  Prerequisites (run from repo root):
    docker compose up -d
    npm run migration:run
    npm run seed            # seeds roles + permissions
    npm run start:dev       # API on http://localhost:3001 (separate terminal)

  Then:  powershell -ExecutionPolicy Bypass -File .\scripts\smoke-bookings.ps1

  Notes
    * There is no admin/member CRUD in this slice, so this script uses a couple of
      psql statements (via the klab-postgres container) purely as test bootstrap:
        - promote one user to the 'owner' role
        - pre-create member rows so credit can be granted before the first booking
      Everything else exercises the real HTTP API.
#>

$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001'
$pw   = 'Password123'

# ── helpers ────────────────────────────────────────────────────────────────
function Body($o) { $o | ConvertTo-Json -Depth 8 }

function Psql([string]$sql) {
  # -t tuples only, -A unaligned -> clean single-value output
  (docker exec klab-postgres psql -U postgres -d klab_booking -t -A -c $sql).Trim()
}

function ApiPost($url, $token, $obj) {
  $h = @{}
  if ($token) { $h['Authorization'] = "Bearer $token" }
  $p = @{ Method = 'Post'; Uri = "$base$url"; Headers = $h; ContentType = 'application/json' }
  if ($null -ne $obj) { $p['Body'] = (Body $obj) }
  (Invoke-RestMethod @p).data
}

function ApiGet($url, $token) {
  (Invoke-RestMethod -Method Get -Uri "$base$url" -Headers @{ Authorization = "Bearer $token" }).data
}

function Register($email, $name) {
  try {
    Invoke-RestMethod -Method Post -Uri "$base/auth/register" -ContentType 'application/json' `
      -Body (Body @{ email = $email; password = $pw; full_name = $name }) | Out-Null
  } catch { } # already registered -> ignore
}

function Login($email) {
  (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' `
      -Body (Body @{ email = $email; password = $pw })).data.access_token
}

function ExpectStatus([scriptblock]$call, [int]$code, [string]$label) {
  try {
    & $call | Out-Null
    Write-Host "  FAIL  $label - expected HTTP $code but call succeeded" -ForegroundColor Red
  } catch {
    $got = $_.Exception.Response.StatusCode.value__
    if ($got -eq $code) { Write-Host "  PASS  $label (HTTP $code)" -ForegroundColor Green }
    else { Write-Host "  FAIL  $label - expected $code, got $got" -ForegroundColor Red }
  }
}

function Ok([string]$label) { Write-Host "  PASS  $label" -ForegroundColor Green }
function Section([string]$t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

# ── 0. accounts ─────────────────────────────────────────────────────────────
Section '0. Accounts + bootstrap'
# Unique per-run suffix (digits only -> always a valid email local-part) so the
# script is safe to run repeatedly: every run creates brand-new users + members
# starting from a 0 credit balance, and every expectation below is based only on
# this run's data. No cleanup of prior runs is needed.
$run        = "$(Get-Date -Format 'yyyyMMddHHmmss')$(Get-Random -Maximum 9999)"
$ownerEmail = "owner$run@klab.test"
$m1Email    = "m1$run@klab.test"
$m2Email    = "m2$run@klab.test"

Register $ownerEmail 'Studio Owner'
Register $m1Email    'Member One'
Register $m2Email    'Member Two'

# promote owner via SQL, then re-login so the JWT carries the owner role
Psql "UPDATE users SET role_id = (SELECT id FROM roles WHERE name='owner') WHERE email='$ownerEmail'" | Out-Null
$owner = Login $ownerEmail
$tok1  = Login $m1Email
$tok2  = Login $m2Email
Ok "registered owner/m1/m2 (run $run) and obtained tokens"

# pre-create member rows (test bootstrap) so we can grant credit before booking
foreach ($e in $m1Email, $m2Email) {
  Psql "INSERT INTO members (user_id, email, first_name, status, credit_balance) SELECT id, email, full_name, 'active', 0 FROM users WHERE email='$e' ON CONFLICT (user_id) DO NOTHING" | Out-Null
}
$m1 = Psql "SELECT id FROM members WHERE email='$m1Email'"
$m2 = Psql "SELECT id FROM members WHERE email='$m2Email'"
Ok "member ids: m1=$m1  m2=$m2"

# ── 1. master data + schedules ──────────────────────────────────────────────
Section '1. Master data + schedules (as owner)'
$room       = ApiPost '/admin/rooms'        $owner @{ name = "Smoke Room $(Get-Random)"; capacity = 20 }
$instructor = ApiPost '/admin/instructors'  $owner @{ first_name = 'Ina'; last_name = 'Structor'; email = "ina$(Get-Random)@klab.test" }
$class      = ApiPost '/admin/class-types'  $owner @{ name = "Reformer $(Get-Random)"; duration_minutes = 60; default_capacity = 10; credit_cost = 1 }
Ok "room=$($room.id)  instructor=$($instructor.id)  class_type=$($class.id) (credit_cost=1)"

function NewSchedule($startHours, $cap) {
  $start = (Get-Date).ToUniversalTime().AddHours($startHours).ToString('o')
  $end   = (Get-Date).ToUniversalTime().AddHours($startHours + 1).ToString('o')
  ApiPost '/admin/schedules' $owner @{
    class_type_id = $class.id; instructor_id = $instructor.id; room_id = $room.id
    start_time = $start; end_time = $end; capacity = $cap
    status = 'published'; is_published = $true
  }
}
$sPaid = NewSchedule 48 5    # far future, normal capacity  -> debit + refundable cancel
$sCap1 = NewSchedule 72 1    # far future, capacity 1       -> overbooking
$sSoon = NewSchedule 2  5    # <12h away                    -> late cancel / no refund
Ok "schedules: paid=$($sPaid.id)  cap1=$($sCap1.id)  soon=$($sSoon.id)"

# ── 2. manual credit adjustment ─────────────────────────────────────────────
Section '2. Manual credit adjustment (members:credit_adjust)'
$adj1 = ApiPost "/admin/members/$m1/credit-adjustment" $owner @{ amount = 5; reason = 'smoke top-up' }
$adj2 = ApiPost "/admin/members/$m2/credit-adjustment" $owner @{ amount = 5; reason = 'smoke top-up' }
if ($adj1.balance_after -eq 5 -and $adj2.balance_after -eq 5) { Ok "granted 5 credits each (balance_after=$($adj1.balance_after))" }
else { Write-Host "  FAIL  unexpected balances $($adj1.balance_after)/$($adj2.balance_after)" -ForegroundColor Red }

ExpectStatus { ApiPost "/admin/members/$m1/credit-adjustment" $owner @{ amount = -9999; reason = 'overdraw' } } 400 'negative adjustment blocked (balance cannot go negative)'
ExpectStatus { ApiPost "/admin/members/$m1/credit-adjustment" $owner @{ amount = 1 } } 400 'reason is required'
ExpectStatus { ApiPost "/admin/members/$m1/credit-adjustment" $tok1  @{ amount = 1; reason = 'x' } } 403 'member cannot self-adjust credit'

# ── 3. create booking + debit ───────────────────────────────────────────────
Section '3. Create booking (debit-on-confirm)'
$b1 = ApiPost '/member/bookings' $tok1 @{ schedule_id = $sPaid.id }
$bal = Psql "SELECT credit_balance FROM members WHERE id='$m1'"
if ($b1.status -eq 'confirmed' -and $b1.credit_cost -eq 1 -and $bal -eq '4') { Ok "booking $($b1.booking_code) confirmed, 1 credit debited, balance=$bal" }
else { Write-Host "  FAIL  status=$($b1.status) cost=$($b1.credit_cost) balance=$bal" -ForegroundColor Red }

$ledger = Psql "SELECT amount || '/' || type FROM credit_ledger WHERE booking_id='$($b1.id)'"
Ok "ledger row for booking: $ledger  (expected -1/booking_debit)"

# ── 4. duplicate booking rejection ──────────────────────────────────────────
Section '4. Duplicate active booking rejection'
ExpectStatus { ApiPost '/member/bookings' $tok1 @{ schedule_id = $sPaid.id } } 409 'second active booking for same schedule rejected'

# ── 5. capacity / overbooking rejection ─────────────────────────────────────
Section '5. Overbooking rejection (capacity = 1)'
$bCap = ApiPost '/member/bookings' $tok1 @{ schedule_id = $sCap1.id }   # fills the 1 slot
Ok "m1 took the only slot ($($bCap.booking_code))"
ExpectStatus { ApiPost '/member/bookings' $tok2 @{ schedule_id = $sCap1.id } } 409 'm2 rejected - schedule full'

# ── 6. cancel with refund (inside window) ───────────────────────────────────
Section '6. Cancel with refund (>12h before start)'
ApiPost "/member/bookings/$($b1.id)/cancel" $tok1 @{ reason = 'change of plans' } | Out-Null
$bal = Psql "SELECT credit_balance FROM members WHERE id='$m1'"
$refund = Psql "SELECT count(*) FROM credit_ledger WHERE booking_id='$($b1.id)' AND type='cancellation_refund'"
# Expected balance = 4: started 5, -1 (step 3 sPaid), -1 (step 5 sCap1), +1 (this refund).
if ($bal -eq '4' -and $refund -eq '1') { Ok "refunded +1 credit (balance now $bal), +1 cancellation_refund ledger row" }
else { Write-Host "  FAIL  balance=$bal refundRows=$refund" -ForegroundColor Red }
ExpectStatus { ApiPost "/member/bookings/$($b1.id)/cancel" $tok1 $null } 409 're-cancel of cancelled booking rejected (idempotent)'

# ── 7. late cancel / no refund (<12h before start) ──────────────────────────
Section '7. Late cancel / no refund (<12h before start)'
$bSoon = ApiPost '/member/bookings' $tok1 @{ schedule_id = $sSoon.id }
$balBefore = Psql "SELECT credit_balance FROM members WHERE id='$m1'"
ApiPost "/member/bookings/$($bSoon.id)/cancel" $tok1 $null | Out-Null
$balAfter = Psql "SELECT credit_balance FROM members WHERE id='$m1'"
if ($balBefore -eq $balAfter) { Ok "no refund on late cancel (balance stayed $balAfter)" }
else { Write-Host "  FAIL  balance changed $balBefore -> $balAfter" -ForegroundColor Red }

# ── 8. admin attendance actions ─────────────────────────────────────────────
Section '8. Admin read / check-in / no-show'
$list = ApiGet "/admin/bookings?member_id=$m1" $owner
Ok "GET /admin/bookings returned $($list.Count) bookings for m1"

$ci = ApiPost "/admin/bookings/$($bCap.id)/check-in" $owner $null
if ($ci.attendance_status -eq 'checked_in') { Ok 'check-in set attendance_status=checked_in' }
else { Write-Host "  FAIL  attendance=$($ci.attendance_status)" -ForegroundColor Red }

$bm2 = ApiPost '/member/bookings' $tok2 @{ schedule_id = $sPaid.id }
$ns  = ApiPost "/admin/bookings/$($bm2.id)/no-show" $owner $null
$m2bal = Psql "SELECT credit_balance FROM members WHERE id='$m2'"
if ($ns.status -eq 'no_show' -and $m2bal -eq '4') { Ok "no-show set status=no_show, credit forfeited (m2 balance=$m2bal)" }
else { Write-Host "  FAIL  status=$($ns.status) m2balance=$m2bal" -ForegroundColor Red }

# ── 9. admin members read ───────────────────────────────────────────────────
Section '9. Admin members read (members:read)'
$detail = ApiGet "/admin/members/$m1" $owner
if ($detail.id -eq $m1 -and $detail.user.email -eq $m1Email -and $null -ne $detail.credit_balance) {
  Ok "GET /admin/members/:id -> email=$($detail.user.email), credit_balance=$($detail.credit_balance)"
} else { Write-Host "  FAIL  detail id=$($detail.id) email=$($detail.user.email)" -ForegroundColor Red }

if ($null -eq $detail.user.password_hash) { Ok 'member view excludes password_hash' }
else { Write-Host '  FAIL  password_hash leaked in member view' -ForegroundColor Red }

$results = ApiGet "/admin/members?status=active&q=$m1Email" $owner
if ($results | Where-Object { $_.id -eq $m1 }) { Ok "GET /admin/members?status=active&q=<m1 email> found m1" }
else { Write-Host '  FAIL  filtered list did not include m1' -ForegroundColor Red }

Write-Host "`nSmoke test complete.`n" -ForegroundColor Cyan
