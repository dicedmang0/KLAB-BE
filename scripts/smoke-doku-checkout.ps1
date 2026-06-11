<#
  Smoke test for DOKU Checkout Foundation (KLAB BE).

  Prerequisites (run from repo root):
    docker compose up -d
    npm run migration:run
    npm run seed
    # Local .env must have DOKU_MOCK=true and a non-empty DOKU_CLIENT_ID/DOKU_SECRET_KEY
    npm run start:dev       # API on http://localhost:3001 (separate terminal)

  Then:  powershell -ExecutionPolicy Bypass -File .\scripts\smoke-doku-checkout.ps1

  This test runs DOKU in MOCK mode (no real network call). It computes a valid DOKU
  notification signature itself using the local DOKU_SECRET_KEY, so the full
  callback -> activation -> idempotency path is exercised against the real API.
#>

$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001'
$pw   = 'Password123'

# These MUST match the local .env values used by the running server.
$dokuClientId  = 'BRN-TEST-LOCAL-0001'
$dokuSecret    = 'SK-local-smoke-test-secret-key'
$callbackPath  = '/payments/doku/callback'

# ── helpers ────────────────────────────────────────────────────────────────
function Body($o) { $o | ConvertTo-Json -Depth 8 -Compress }

function Psql([string]$sql) {
  (docker exec klab-postgres psql -U postgres -d klab_booking -t -A -c $sql).Trim()
}

function Register($email, $name) {
  try {
    Invoke-RestMethod -Method Post -Uri "$base/auth/register" -ContentType 'application/json' `
      -Body (@{ email = $email; password = $pw; full_name = $name } | ConvertTo-Json) | Out-Null
  } catch { }
}
function Login($email) {
  (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' `
      -Body (@{ email = $email; password = $pw } | ConvertTo-Json)).data.access_token
}
function ApiPost($url, $token, $obj) {
  $h = @{}
  if ($token) { $h['Authorization'] = "Bearer $token" }
  $p = @{ Method = 'Post'; Uri = "$base$url"; Headers = $h; ContentType = 'application/json' }
  if ($null -ne $obj) { $p['Body'] = ($obj | ConvertTo-Json -Depth 8) }
  (Invoke-RestMethod @p).data
}

# DOKU signature: HMACSHA256=Base64(HMAC-SHA256(component, secret))
# component = Client-Id / Request-Id / Request-Timestamp / Request-Target / Digest
# Digest    = Base64(SHA256(rawBody))
function DokuDigest([string]$rawBody) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($rawBody))
  return [System.Convert]::ToBase64String($hash)
}
function DokuSign([string]$rawBody, [string]$requestId, [string]$timestamp, [string]$target) {
  $digest = DokuDigest $rawBody
  $component = "Client-Id:$dokuClientId`nRequest-Id:$requestId`nRequest-Timestamp:$timestamp`nRequest-Target:$target`nDigest:$digest"
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($dokuSecret))
  $sig = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($component))
  return "HMACSHA256=" + [System.Convert]::ToBase64String($sig)
}

# POST a DOKU callback. $sign controls whether to send a valid signature.
function PostCallback([string]$rawBody, [bool]$validSig) {
  $requestId = [guid]::NewGuid().ToString()
  $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  if ($validSig) {
    $sig = DokuSign $rawBody $requestId $timestamp $callbackPath
  } else {
    $sig = "HMACSHA256=deadbeefinvalidsignaturevalue=="
  }
  $headers = @{
    'Client-Id'         = $dokuClientId
    'Request-Id'        = $requestId
    'Request-Timestamp' = $timestamp
    'Signature'         = $sig
  }
  return Invoke-WebRequest -Method Post -Uri "$base$callbackPath" -Headers $headers `
    -ContentType 'application/json' -Body $rawBody -UseBasicParsing
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

# Build a DOKU notification body for a given invoice/amount/status
function CallbackBody([string]$invoice, [int]$amount, [string]$status, [string]$method) {
  $obj = [ordered]@{
    order       = [ordered]@{ invoice_number = $invoice; amount = "$amount" }
    transaction = [ordered]@{ status = $status; date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"); original_request_id = [guid]::NewGuid().ToString() }
    channel     = [ordered]@{ id = $method }
  }
  return ($obj | ConvertTo-Json -Depth 8 -Compress)
}

# ── 0. bootstrap ─────────────────────────────────────────────────────────────
Section '0. Accounts + bootstrap'
$run        = "$(Get-Date -Format 'yyyyMMddHHmmss')$(Get-Random -Maximum 9999)"
$ownerEmail = "owner$run@klab.test"
$mEmail     = "doku$run@klab.test"
Register $ownerEmail 'Studio Owner'
Register $mEmail     'Doku Member'
Psql "UPDATE users SET role_id = (SELECT id FROM roles WHERE name='owner') WHERE email='$ownerEmail'" | Out-Null
$owner = Login $ownerEmail
$tok   = Login $mEmail
Ok "registered owner/member (run=$run)"

# ── 1. create a published package ─────────────────────────────────────────────
Section '1. Create published package'
$pkg = ApiPost '/admin/packages' $owner @{
  name = "DOKU Pack $(Get-Random)"; description = '10-credit pack'
  price_idr = 750000; credit_amount = 10; is_unlimited = $false
  validity_days = 30; is_published = $true; status = 'active'
}
Ok "package=$($pkg.id) price_idr=$($pkg.price_idr) credit_amount=$($pkg.credit_amount)"

# ── 2. checkout creates a pending payment + returns mock checkout_url ──────────
Section '2. POST /member/packages/:id/checkout (mock)'
$checkout = ApiPost "/member/packages/$($pkg.id)/checkout" $tok $null
$mId = Psql "SELECT id FROM members WHERE email='$mEmail'"
$payRow = Psql "SELECT status || '|' || amount_idr FROM payments WHERE payment_code='$($checkout.payment_code)'"
if ($checkout.status -eq 'pending' -and $checkout.checkout_url -and $checkout.amount_idr -eq 750000) {
  Ok "checkout -> code=$($checkout.payment_code) status=pending amount=$($checkout.amount_idr)"
} else { Write-Host "  FAIL  checkout=$($checkout | ConvertTo-Json -Compress)" -ForegroundColor Red }
if ($checkout.checkout_url -match 'mock=1') { Ok "mock checkout_url returned: $($checkout.checkout_url)" }
else { Write-Host "  FAIL  checkout_url not a mock url: $($checkout.checkout_url)" -ForegroundColor Red }
if ($payRow -eq 'pending|750000') { Ok "DB payment row is pending, amount 750000" }
else { Write-Host "  FAIL  payment row = $payRow" -ForegroundColor Red }

# Checkout must NOT activate anything yet
$mpCount0  = Psql "SELECT count(*) FROM member_packages WHERE member_id='$mId'"
$balance0  = Psql "SELECT credit_balance FROM members WHERE id='$mId'"
if ($mpCount0 -eq '0' -and $balance0 -eq '0') { Ok "no member_package, balance still 0 after checkout (no activation)" }
else { Write-Host "  FAIL  premature activation mp=$mpCount0 balance=$balance0" -ForegroundColor Red }

# ── 3. invalid signature callback is rejected and does not activate ───────────
Section '3. Invalid signature callback'
$bodyPaid = CallbackBody $checkout.payment_code 750000 'SUCCESS' 'VIRTUAL_ACCOUNT_BCA'
ExpectStatus { PostCallback $bodyPaid $false } 401 'invalid signature rejected (401)'
$mpAfterBad = Psql "SELECT count(*) FROM member_packages WHERE member_id='$mId'"
$balAfterBad = Psql "SELECT credit_balance FROM members WHERE id='$mId'"
if ($mpAfterBad -eq '0' -and $balAfterBad -eq '0') { Ok "invalid signature did NOT activate (mp=0 balance=0)" }
else { Write-Host "  FAIL  invalid sig activated something mp=$mpAfterBad balance=$balAfterBad" -ForegroundColor Red }
# but it was still stored for audit
$auditBad = Psql "SELECT count(*) FROM doku_transactions WHERE order_id='$($checkout.payment_code)' AND signature_valid=false"
if ([int]$auditBad -ge 1) { Ok "invalid callback stored for audit (signature_valid=false rows=$auditBad)" }
else { Write-Host "  FAIL  invalid callback not stored for audit" -ForegroundColor Red }

# ── 4. valid paid callback activates package + credits ────────────────────────
Section '4. Valid paid callback activates'
$resp = PostCallback $bodyPaid $true
$payStatus = Psql "SELECT status FROM payments WHERE payment_code='$($checkout.payment_code)'"
$mpCount1  = Psql "SELECT count(*) FROM member_packages WHERE payment_id=(SELECT id FROM payments WHERE payment_code='$($checkout.payment_code)')"
$balance1  = Psql "SELECT credit_balance FROM members WHERE id='$mId'"
$ledger1   = Psql "SELECT count(*) FROM credit_ledger WHERE member_id='$mId' AND type='package_purchase'"
if ($resp.StatusCode -eq 200 -and $payStatus -eq 'paid') { Ok "callback 200, payment status=paid" }
else { Write-Host "  FAIL  http=$($resp.StatusCode) payStatus=$payStatus" -ForegroundColor Red }
if ($mpCount1 -eq '1') { Ok "exactly 1 member_package created for the payment" }
else { Write-Host "  FAIL  member_package count=$mpCount1 (expected 1)" -ForegroundColor Red }
if ($balance1 -eq '10') { Ok "credit_balance activated to 10" }
else { Write-Host "  FAIL  credit_balance=$balance1 (expected 10)" -ForegroundColor Red }
if ($ledger1 -eq '1') { Ok "exactly 1 package_purchase ledger row" }
else { Write-Host "  FAIL  package_purchase ledger rows=$ledger1 (expected 1)" -ForegroundColor Red }

# ── 5. duplicate paid callback is idempotent ──────────────────────────────────
Section '5. Duplicate paid callback (idempotency)'
$resp2 = PostCallback $bodyPaid $true
$mpCount2 = Psql "SELECT count(*) FROM member_packages WHERE payment_id=(SELECT id FROM payments WHERE payment_code='$($checkout.payment_code)')"
$balance2 = Psql "SELECT credit_balance FROM members WHERE id='$mId'"
$ledger2  = Psql "SELECT count(*) FROM credit_ledger WHERE member_id='$mId' AND type='package_purchase'"
if ($resp2.StatusCode -eq 200) { Ok "duplicate callback acknowledged (200)" }
else { Write-Host "  FAIL  duplicate callback http=$($resp2.StatusCode)" -ForegroundColor Red }
if ($mpCount2 -eq '1') { Ok "member_package NOT duplicated (still 1)" }
else { Write-Host "  FAIL  member_package duplicated count=$mpCount2" -ForegroundColor Red }
if ($ledger2 -eq '1') { Ok "package_purchase ledger NOT duplicated (still 1)" }
else { Write-Host "  FAIL  ledger duplicated count=$ledger2" -ForegroundColor Red }
if ($balance2 -eq '10') { Ok "credit_balance unchanged on duplicate (still 10)" }
else { Write-Host "  FAIL  balance changed on duplicate=$balance2" -ForegroundColor Red }

# ── 6. failed/expired callback does not activate ──────────────────────────────
Section '6. Failed + expired callbacks do not activate'
# New checkout for a fresh pending payment
$checkout2 = ApiPost "/member/packages/$($pkg.id)/checkout" $tok $null
$bodyFailed = CallbackBody $checkout2.payment_code 750000 'FAILED' 'VIRTUAL_ACCOUNT_BCA'
PostCallback $bodyFailed $true | Out-Null
$pay2Status = Psql "SELECT status FROM payments WHERE payment_code='$($checkout2.payment_code)'"
$mpForP2 = Psql "SELECT count(*) FROM member_packages WHERE payment_id=(SELECT id FROM payments WHERE payment_code='$($checkout2.payment_code)')"
if ($pay2Status -eq 'failed' -and $mpForP2 -eq '0') { Ok "failed callback -> payment failed, no member_package" }
else { Write-Host "  FAIL  pay2Status=$pay2Status mpForP2=$mpForP2" -ForegroundColor Red }

$checkout3 = ApiPost "/member/packages/$($pkg.id)/checkout" $tok $null
$bodyExpired = CallbackBody $checkout3.payment_code 750000 'EXPIRED' 'VIRTUAL_ACCOUNT_BCA'
PostCallback $bodyExpired $true | Out-Null
$pay3Status = Psql "SELECT status FROM payments WHERE payment_code='$($checkout3.payment_code)'"
$mpForP3 = Psql "SELECT count(*) FROM member_packages WHERE payment_id=(SELECT id FROM payments WHERE payment_code='$($checkout3.payment_code)')"
if ($pay3Status -eq 'expired' -and $mpForP3 -eq '0') { Ok "expired callback -> payment expired, no member_package" }
else { Write-Host "  FAIL  pay3Status=$pay3Status mpForP3=$mpForP3" -ForegroundColor Red }

# balance unchanged by failed/expired (still 10 from step 4)
$balanceFinal = Psql "SELECT credit_balance FROM members WHERE id='$mId'"
if ($balanceFinal -eq '10') { Ok "credit_balance unaffected by failed/expired (still 10)" }
else { Write-Host "  FAIL  balance changed by failed/expired=$balanceFinal" -ForegroundColor Red }

# ── 7. amount mismatch on paid callback is rejected ───────────────────────────
Section '7. Amount mismatch guard'
$checkout4 = ApiPost "/member/packages/$($pkg.id)/checkout" $tok $null
$bodyWrongAmt = CallbackBody $checkout4.payment_code 1 'SUCCESS' 'VIRTUAL_ACCOUNT_BCA'
ExpectStatus { PostCallback $bodyWrongAmt $true } 400 'amount mismatch rejected (400)'
$pay4Status = Psql "SELECT status FROM payments WHERE payment_code='$($checkout4.payment_code)'"
$mpForP4 = Psql "SELECT count(*) FROM member_packages WHERE payment_id=(SELECT id FROM payments WHERE payment_code='$($checkout4.payment_code)')"
if ($pay4Status -eq 'pending' -and $mpForP4 -eq '0') { Ok "amount mismatch did NOT activate (payment still pending)" }
else { Write-Host "  FAIL  pay4Status=$pay4Status mpForP4=$mpForP4" -ForegroundColor Red }

Write-Host "`nSmoke test complete.`n" -ForegroundColor Cyan
