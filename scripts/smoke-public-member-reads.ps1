<#
  Smoke test for Public + Member Read APIs (KLAB BE).

  Prerequisites (run from repo root):
    docker compose up -d
    npm run migration:run
    npm run seed
    npm run start:dev       # API on http://localhost:3001 (separate terminal)

  Then:  powershell -ExecutionPolicy Bypass -File .\scripts\smoke-public-member-reads.ps1
#>

$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001'
$pw   = 'Password123'

# ── helpers ────────────────────────────────────────────────────────────────
function Body($o) { $o | ConvertTo-Json -Depth 8 }

function Psql([string]$sql) {
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
  $h = @{}
  if ($token) { $h['Authorization'] = "Bearer $token" }
  (Invoke-RestMethod -Method Get -Uri "$base$url" -Headers $h).data
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

function Register($email, $name) {
  try {
    Invoke-RestMethod -Method Post -Uri "$base/auth/register" -ContentType 'application/json' `
      -Body (Body @{ email = $email; password = $pw; full_name = $name }) | Out-Null
  } catch { }
}

function Login($email) {
  (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' `
      -Body (Body @{ email = $email; password = $pw })).data.access_token
}

# ── 0. bootstrap ─────────────────────────────────────────────────────────────
Section '0. Accounts + bootstrap'
$run        = "$(Get-Date -Format 'yyyyMMddHHmmss')$(Get-Random -Maximum 9999)"
$ownerEmail = "owner$run@klab.test"
$m1Email    = "pub1$run@klab.test"
$m2Email    = "pub2$run@klab.test"   # second member to test cross-member booking isolation

Register $ownerEmail 'Studio Owner'
Register $m1Email    'Pub Member One'
Register $m2Email    'Pub Member Two'

Psql "UPDATE users SET role_id = (SELECT id FROM roles WHERE name='owner') WHERE email='$ownerEmail'" | Out-Null
$owner = Login $ownerEmail
$tok1  = Login $m1Email
$tok2  = Login $m2Email
Ok "registered owner/m1/m2 (run=$run)"

# ── 1. create master data (published) ────────────────────────────────────────
Section '1. Master data: create published class types, packages, schedules'

$class = ApiPost '/admin/class-types' $owner @{
  name = "Pilates Pub $(Get-Random)"; duration_minutes = 60
  default_capacity = 10; credit_cost = 2
  is_published = $true; status = 'active'
}
$room       = ApiPost '/admin/rooms'       $owner @{ name = "Pub Room $(Get-Random)"; capacity = 20 }
$instructor = ApiPost '/admin/instructors' $owner @{
  first_name = 'Ina'; last_name = 'Pub'; email = "ina$run@klab.test"
}
$pkg = ApiPost '/admin/packages' $owner @{
  name = "Pub Pack $(Get-Random)"; description = '10-credit public pack'
  price_idr = 500000; credit_amount = 10
  is_unlimited = $false; validity_days = 30
  is_published = $true; status = 'active'
}
$pkgHidden = ApiPost '/admin/packages' $owner @{
  name = "Hidden Pack $(Get-Random)"; price_idr = 100000; credit_amount = 5
  is_unlimited = $false; validity_days = 30
  is_published = $false; status = 'active'   # NOT published
}
$classHidden = ApiPost '/admin/class-types' $owner @{
  name = "Hidden CT $(Get-Random)"; duration_minutes = 45
  default_capacity = 5; credit_cost = 1
  is_published = $false; status = 'active'   # NOT published
}

# Two schedules: one with capacity 2 (to test available_slots) and one future
$start2 = (Get-Date).ToUniversalTime().AddHours(48).ToString('o')
$end2   = (Get-Date).ToUniversalTime().AddHours(49).ToString('o')
$sCap2 = ApiPost '/admin/schedules' $owner @{
  class_type_id = $class.id; instructor_id = $instructor.id; room_id = $room.id
  start_time = $start2; end_time = $end2; capacity = 2
  status = 'published'; is_published = $true
}

$start3 = (Get-Date).ToUniversalTime().AddHours(72).ToString('o')
$end3   = (Get-Date).ToUniversalTime().AddHours(73).ToString('o')
$sNorm = ApiPost '/admin/schedules' $owner @{
  class_type_id = $class.id; instructor_id = $instructor.id; room_id = $room.id
  start_time = $start3; end_time = $end3; capacity = 10
  status = 'published'; is_published = $true
}

# Also create a cancelled schedule that must NOT appear in public
$start4 = (Get-Date).ToUniversalTime().AddHours(96).ToString('o')
$end4   = (Get-Date).ToUniversalTime().AddHours(97).ToString('o')
$sCancelled = ApiPost '/admin/schedules' $owner @{
  class_type_id = $class.id; instructor_id = $instructor.id; room_id = $room.id
  start_time = $start4; end_time = $end4; capacity = 5
  status = 'draft'; is_published = $false   # draft/unpublished -> should not appear
}

Ok "class=$($class.id)  pkg=$($pkg.id)  sCap2=$($sCap2.id)  sNorm=$($sNorm.id)  draft=$($sCancelled.id)"

# ── 2. public class types ─────────────────────────────────────────────────────
Section '2. GET /public/class-types (no auth)'
$ctList = ApiGet '/public/class-types' $null
if ($ctList | Where-Object { $_.id -eq $class.id }) { Ok "published class type appears in public list" }
else { Write-Host "  FAIL  published class type missing from /public/class-types" -ForegroundColor Red }
if ($ctList | Where-Object { $_.id -eq $classHidden.id }) {
  Write-Host "  FAIL  unpublished class type leaked in public list" -ForegroundColor Red
} else { Ok "unpublished class type NOT in public list" }

$ctDetail = ApiGet "/public/class-types/$($class.id)" $null
if ($ctDetail.id -eq $class.id -and $null -ne $ctDetail.credit_cost) {
  Ok "GET /public/class-types/:id -> credit_cost=$($ctDetail.credit_cost)"
} else { Write-Host "  FAIL  class type detail missing fields" -ForegroundColor Red }

# Verify internal fields not exposed
if ($null -ne $ctDetail.PSObject.Properties['default_price_idr']) {
  Write-Host "  FAIL  default_price_idr leaked in public class type" -ForegroundColor Red
} else { Ok "default_price_idr not exposed in public class type" }
if ($null -ne $ctDetail.PSObject.Properties['status']) {
  Write-Host "  FAIL  status field leaked in public class type" -ForegroundColor Red
} else { Ok "status field not exposed in public class type" }

ExpectStatus { ApiGet "/public/class-types/$($classHidden.id)" $null } 404 'hidden class type returns 404 on direct access'

# ── 3. public packages ────────────────────────────────────────────────────────
Section '3. GET /public/packages (no auth)'
$pkgList = ApiGet '/public/packages' $null
if ($pkgList | Where-Object { $_.id -eq $pkg.id }) { Ok "published package appears in public list" }
else { Write-Host "  FAIL  published package missing from /public/packages" -ForegroundColor Red }
if ($pkgList | Where-Object { $_.id -eq $pkgHidden.id }) {
  Write-Host "  FAIL  unpublished package leaked in public list" -ForegroundColor Red
} else { Ok "unpublished package NOT in public list" }

$pkgDetail = ApiGet "/public/packages/$($pkg.id)" $null
# Verify required FE fields
$requiredFields = @('id','name','price_idr','credit_amount','validity_days','is_unlimited')
foreach ($f in $requiredFields) {
  if ($null -eq $pkgDetail.PSObject.Properties[$f]) {
    Write-Host "  FAIL  /public/packages/:id missing field: $f" -ForegroundColor Red
  } else { Ok "/public/packages/:id has field: $f=$($pkgDetail.$f)" }
}

ExpectStatus { ApiGet "/public/packages/$($pkgHidden.id)" $null } 404 'hidden package returns 404 on direct access'

# ── 4. public schedules + available_slots ─────────────────────────────────────
Section '4. GET /public/schedules — available_slots + is_full'
$schedList = ApiGet '/public/schedules' $null
$sCap2Pub = $schedList | Where-Object { $_.id -eq $sCap2.id }
$sNormPub  = $schedList | Where-Object { $_.id -eq $sNorm.id  }
if ($sCap2Pub) { Ok "capacity-2 schedule visible in /public/schedules" }
else { Write-Host "  FAIL  capacity-2 schedule missing from /public/schedules" -ForegroundColor Red }
# Draft schedule must not appear
if ($schedList | Where-Object { $_.id -eq $sCancelled.id }) {
  Write-Host "  FAIL  draft/unpublished schedule leaked in public list" -ForegroundColor Red
} else { Ok "draft schedule NOT in public schedule list" }
# Check projection fields
$sDetail = ApiGet "/public/schedules/$($sCap2.id)" $null
$requiredSchedFields = @('id','start_time','end_time','capacity','available_slots','is_full','class_type','instructor','room')
foreach ($f in $requiredSchedFields) {
  if ($null -eq $sDetail.PSObject.Properties[$f]) {
    Write-Host "  FAIL  schedule detail missing field: $f" -ForegroundColor Red
  }
}
Ok "all required schedule fields present"
# Instructor must not expose email/phone/user_id
if ($null -ne $sDetail.instructor.PSObject.Properties['email']) {
  Write-Host "  FAIL  instructor email leaked in public schedule" -ForegroundColor Red
} else { Ok "instructor email not exposed in public schedule" }
if ($null -ne $sDetail.instructor.PSObject.Properties['user_id']) {
  Write-Host "  FAIL  instructor user_id leaked in public schedule" -ForegroundColor Red
} else { Ok "instructor user_id not exposed in public schedule" }
# Internal schedule fields
if ($null -ne $sDetail.PSObject.Properties['created_by']) {
  Write-Host "  FAIL  created_by leaked in public schedule" -ForegroundColor Red
} else { Ok "created_by not exposed in public schedule" }
if ($null -ne $sDetail.PSObject.Properties['recurrence_rule']) {
  Write-Host "  FAIL  recurrence_rule leaked in public schedule" -ForegroundColor Red
} else { Ok "recurrence_rule not exposed in public schedule" }

# available_slots before any bookings: should equal capacity (2)
if ($sDetail.available_slots -eq 2 -and $sDetail.is_full -eq $false) {
  Ok "available_slots=$($sDetail.available_slots) is_full=$($sDetail.is_full) (0 bookings, cap=2)"
} else { Write-Host "  FAIL  available_slots=$($sDetail.available_slots) is_full=$($sDetail.is_full)" -ForegroundColor Red }

# Grant m1 2 credits, book 1 slot on sCap2, verify available_slots drops to 1
Psql "INSERT INTO members (user_id, email, first_name, status, credit_balance) SELECT id, email, full_name, 'active', 10 FROM users WHERE email='$m1Email' ON CONFLICT (user_id) DO NOTHING" | Out-Null
Psql "INSERT INTO members (user_id, email, first_name, status, credit_balance) SELECT id, email, full_name, 'active', 10 FROM users WHERE email='$m2Email' ON CONFLICT (user_id) DO NOTHING" | Out-Null
$bk1 = ApiPost '/member/bookings' $tok1 @{ schedule_id = $sCap2.id }
$sAfter1 = ApiGet "/public/schedules/$($sCap2.id)" $null
if ($sAfter1.available_slots -eq 1 -and $sAfter1.is_full -eq $false) {
  Ok "available_slots=$($sAfter1.available_slots) after 1 booking (cap=2)"
} else { Write-Host "  FAIL  available_slots=$($sAfter1.available_slots) (expected 1)" -ForegroundColor Red }

# Book 2nd slot: schedule should be is_full=true
ApiPost '/member/bookings' $tok2 @{ schedule_id = $sCap2.id } | Out-Null
$sAfter2 = ApiGet "/public/schedules/$($sCap2.id)" $null
if ($sAfter2.available_slots -eq 0 -and $sAfter2.is_full -eq $true) {
  Ok "available_slots=0 is_full=true after 2 bookings (cap=2)"
} else { Write-Host "  FAIL  available_slots=$($sAfter2.available_slots) is_full=$($sAfter2.is_full)" -ForegroundColor Red }

ExpectStatus { ApiGet "/public/schedules/$($sCancelled.id)" $null } 404 'draft schedule returns 404 on direct access'

# ── 5. member/me ──────────────────────────────────────────────────────────────
Section '5. GET /member/me'
$me = ApiGet '/member/me' $tok1
if ($me.id -and $me.status -eq 'active' -and $null -ne $me.credit_balance) {
  Ok "member/me -> id=$($me.id) credit_balance=$($me.credit_balance)"
} else { Write-Host "  FAIL  member/me missing expected fields: $($me | ConvertTo-Json -Compress)" -ForegroundColor Red }
# Must NOT expose password_hash (not on Member entity, but double-check)
if ($null -ne $me.PSObject.Properties['password_hash']) {
  Write-Host "  FAIL  password_hash leaked in /member/me" -ForegroundColor Red
} else { Ok "password_hash not in /member/me" }
# Must NOT expose notes (internal admin field)
if ($null -ne $me.PSObject.Properties['notes']) {
  Write-Host "  FAIL  notes leaked in /member/me" -ForegroundColor Red
} else { Ok "notes not in /member/me" }
# Must NOT expose nested user object
if ($null -ne $me.PSObject.Properties['user']) {
  Write-Host "  FAIL  user object leaked in /member/me" -ForegroundColor Red
} else { Ok "user object not in /member/me" }
# Unauthenticated access must fail
ExpectStatus { ApiGet '/member/me' $null } 401 'GET /member/me rejects unauthenticated request'

# ── 6. member/credits ─────────────────────────────────────────────────────────
Section '6. GET /member/credits'
$credits = ApiGet '/member/credits' $tok1
if ($null -ne $credits.credit_balance -and $null -ne $credits.ledger) {
  Ok "member/credits -> credit_balance=$($credits.credit_balance) ledger_entries=$($credits.ledger.Count)"
} else { Write-Host "  FAIL  member/credits missing fields: $($credits | ConvertTo-Json -Compress)" -ForegroundColor Red }
# Verify created_by is stripped
if ($credits.ledger.Count -gt 0 -and ($null -ne $credits.ledger[0].PSObject.Properties['created_by'])) {
  Write-Host "  FAIL  created_by leaked in credit ledger entry" -ForegroundColor Red
} else { Ok "created_by not in credit ledger entries" }
# Unauthenticated access must fail
ExpectStatus { ApiGet '/member/credits' $null } 401 'GET /member/credits rejects unauthenticated request'

# ── 7. member/bookings/:id — own-only protection ──────────────────────────────
Section '7. GET /member/bookings/:id — own-only'
$bkDetail = ApiGet "/member/bookings/$($bk1.id)" $tok1
if ($bkDetail.id -eq $bk1.id -and $null -ne $bkDetail.schedule) {
  Ok "GET /member/bookings/:id -> id=$($bkDetail.id) has schedule object"
} else { Write-Host "  FAIL  booking detail missing expected fields" -ForegroundColor Red }
# Verify schedule nested relations are present
if ($null -ne $bkDetail.schedule.PSObject.Properties['class_type']) {
  Ok "schedule.class_type present in booking detail"
} else { Write-Host "  FAIL  schedule.class_type missing in booking detail" -ForegroundColor Red }
if ($null -ne $bkDetail.schedule.PSObject.Properties['instructor']) {
  Ok "schedule.instructor present in booking detail"
} else { Write-Host "  FAIL  schedule.instructor missing in booking detail" -ForegroundColor Red }
if ($null -ne $bkDetail.schedule.PSObject.Properties['room']) {
  Ok "schedule.room present in booking detail"
} else { Write-Host "  FAIL  schedule.room missing in booking detail" -ForegroundColor Red }
# Must NOT expose member object (member is the caller, we don't echo it back)
if ($null -ne $bkDetail.PSObject.Properties['member'] -and $null -ne $bkDetail.member) {
  Write-Host "  FAIL  member object present in booking detail (should be absent)" -ForegroundColor Red
} else { Ok "member object not returned in booking detail (correct)" }

# m2 cannot access m1's booking — must get 404 (own-only via member_id filter)
ExpectStatus { ApiGet "/member/bookings/$($bk1.id)" $tok2 } 404 'm2 cannot access m1 booking (cross-member isolation)'
# Unauthenticated access must fail
ExpectStatus { ApiGet "/member/bookings/$($bk1.id)" $null } 401 'unauthenticated access to booking detail rejected'

Write-Host "`nSmoke test complete.`n" -ForegroundColor Cyan
