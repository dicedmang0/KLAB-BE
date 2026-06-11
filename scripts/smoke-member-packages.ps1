<#
  Smoke test for Member Packages + Package Purchase Foundation (KLAB BE).

  Prerequisites (run from repo root):
    docker compose up -d
    npm run migration:run
    npm run seed            # seeds roles + permissions
    npm run start:dev       # API on http://localhost:3001 (separate terminal)

  Then:  powershell -ExecutionPolicy Bypass -File .\scripts\smoke-member-packages.ps1

  Notes
    * Uses a couple of psql statements (via the klab-postgres container) purely as
      test bootstrap (promote a user to 'owner', read DB rows to assert side effects).
      Everything else exercises the real HTTP API.
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

# ── 0. accounts + bootstrap ──────────────────────────────────────────────────
Section '0. Accounts + bootstrap'
$run        = "$(Get-Date -Format 'yyyyMMddHHmmss')$(Get-Random -Maximum 9999)"
$ownerEmail = "owner$run@klab.test"
$mEmail     = "mp$run@klab.test"

Register $ownerEmail 'Studio Owner'
Register $mEmail     'Package Member'

Psql "UPDATE users SET role_id = (SELECT id FROM roles WHERE name='owner') WHERE email='$ownerEmail'" | Out-Null
$owner = Login $ownerEmail
$tok   = Login $mEmail
Ok "registered owner/member (run $run) and obtained tokens"

# ── 1. create a package (as owner) ───────────────────────────────────────────
Section '1. Create package (packages:create)'
$pkg = ApiPost '/admin/packages' $owner @{
  name = "Smoke Pack $(Get-Random)"; description = '10-credit pack'
  price_idr = 500000; credit_amount = 10; is_unlimited = $false
  validity_days = 30; is_published = $true; status = 'active'
}
Ok "package=$($pkg.id) credit_amount=$($pkg.credit_amount) validity_days=$($pkg.validity_days)"

# ── 2. manual package assignment (packages:sell) ─────────────────────────────
Section '2. Manual package assignment (POST /admin/members/:id/packages)'
# Member row is created lazily by the API; trigger it via a purchase-intent first
# so we have a member id to assign to.
$intent0 = ApiPost "/member/packages/$($pkg.id)/purchase-intent" $tok $null
$mId = $intent0.member_id
$balBefore = Psql "SELECT credit_balance FROM members WHERE id='$mId'"
Ok "member id=$mId  balance before assignment=$balBefore"

$mp = ApiPost "/admin/members/$mId/packages" $owner @{ package_id = $pkg.id; reason = 'smoke comp grant' }
$balAfter = Psql "SELECT credit_balance FROM members WHERE id='$mId'"
$ledger = Psql "SELECT amount || '/' || type FROM credit_ledger WHERE member_package_id='$($mp.id)'"
if ($mp.status -eq 'active' -and $mp.credits_total -eq 10 -and $mp.credits_remaining -eq 10) {
  Ok "member_package $($mp.id) active, credits_total/remaining=10"
} else { Write-Host "  FAIL  status=$($mp.status) total=$($mp.credits_total) remaining=$($mp.credits_remaining)" -ForegroundColor Red }
if ([int]$balAfter - [int]$balBefore -eq 10) { Ok "credit_balance +10 (=$balAfter)" }
else { Write-Host "  FAIL  balance $balBefore -> $balAfter (expected +10)" -ForegroundColor Red }
Ok "ledger row for grant: $ledger  (expected 10/package_purchase)"

# ── 3. admin reads ───────────────────────────────────────────────────────────
Section '3. Admin reads (packages:read)'
$detail = ApiGet "/admin/member-packages/$($mp.id)" $owner
if ($detail.id -eq $mp.id -and $detail.package.id -eq $pkg.id) { Ok "GET /admin/member-packages/:id -> package=$($detail.package.name)" }
else { Write-Host "  FAIL  detail id=$($detail.id) package=$($detail.package.id)" -ForegroundColor Red }

$list = ApiGet "/admin/member-packages?member_id=$mId&status=active" $owner
if ($list | Where-Object { $_.id -eq $mp.id }) { Ok "GET /admin/member-packages?member_id=&status=active found the grant" }
else { Write-Host '  FAIL  filtered list did not include the grant' -ForegroundColor Red }

# ── 4. member reads own packages ─────────────────────────────────────────────
Section '4. Member reads own packages (GET /member/packages/my)'
$mine = ApiGet '/member/packages/my' $tok
if ($mine | Where-Object { $_.id -eq $mp.id }) { Ok "member sees own member_package $($mp.id)" }
else { Write-Host '  FAIL  member did not see own package' -ForegroundColor Red }

# ── 5. purchase intent is non-persistent ─────────────────────────────────────
Section '5. Purchase intent (no payment gateway yet)'
$balPre   = Psql "SELECT credit_balance FROM members WHERE id='$mId'"
$mpCntPre = Psql "SELECT count(*) FROM member_packages WHERE member_id='$mId'"
$ledPre   = Psql "SELECT count(*) FROM credit_ledger WHERE member_id='$mId'"
$intent = ApiPost "/member/packages/$($pkg.id)/purchase-intent" $tok $null
$balPost   = Psql "SELECT credit_balance FROM members WHERE id='$mId'"
$mpCntPost = Psql "SELECT count(*) FROM member_packages WHERE member_id='$mId'"
$ledPost   = Psql "SELECT count(*) FROM credit_ledger WHERE member_id='$mId'"
if ($intent.status -eq 'intent' -and $intent.payment_required -eq $true -and $intent.amount_idr -eq 500000) {
  Ok "intent preview returned (status=intent, amount_idr=$($intent.amount_idr), payment_required=$($intent.payment_required))"
} else { Write-Host "  FAIL  intent=$($intent | ConvertTo-Json -Compress)" -ForegroundColor Red }
if ($balPre -eq $balPost -and $mpCntPre -eq $mpCntPost -and $ledPre -eq $ledPost) {
  Ok "intent persisted nothing (balance/$balPost member_packages/$mpCntPost ledger/$ledPost unchanged)"
} else { Write-Host "  FAIL  intent had side effects bal:$balPre->$balPost mp:$mpCntPre->$mpCntPost led:$ledPre->$ledPost" -ForegroundColor Red }

# ── 6. authorization ─────────────────────────────────────────────────────────
Section '6. Authorization'
ExpectStatus { ApiPost "/admin/members/$mId/packages" $tok @{ package_id = $pkg.id } } 403 'member cannot assign packages (needs packages:sell)'
ExpectStatus { ApiGet "/admin/member-packages" $tok } 403 'member cannot list all member-packages'

# unpublished package cannot be purchase-intented
$hidden = ApiPost '/admin/packages' $owner @{
  name = "Hidden $(Get-Random)"; price_idr = 100000; credit_amount = 5
  is_unlimited = $false; validity_days = 30; is_published = $false; status = 'active'
}
ExpectStatus { ApiPost "/member/packages/$($hidden.id)/purchase-intent" $tok $null } 400 'unpublished package rejected for purchase-intent'

Write-Host "`nSmoke test complete.`n" -ForegroundColor Cyan
