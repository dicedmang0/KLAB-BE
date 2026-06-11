<#
  Sandbox checkout driver for DOKU Checkout (KLAB BE) -- REAL sandbox call.

  This does NOT mock. It drives a real POST /member/packages/:id/checkout against
  the running server, which calls the DOKU sandbox create-payment API and returns
  a real DOKU-hosted checkout_url. It does NOT require completing the payment to
  pass -- it passes as soon as DOKU returns a real checkout URL.

  Prerequisites (run from repo root):
    1. In your local .env (gitignored):
         DOKU_MOCK=false
         DOKU_ENV=sandbox
         DOKU_CLIENT_ID=<your sandbox client id>
         DOKU_SECRET_KEY=<your sandbox secret key>
         DOKU_CHECKOUT_SANDBOX_URL=https://api-sandbox.doku.com/checkout/v1/payment
         # For full end-to-end (receiving the callback) point these at your ngrok URL:
         DOKU_CALLBACK_URL=https://<ngrok>/payments/doku/callback
         DOKU_RETURN_URL=https://<ngrok>/checkout/result   (or your FE result page)
    2. docker compose up -d
    3. npm run migration:run
    4. npm run seed
    5. npm run start:dev   (RESTART after editing .env so DOKU_MOCK=false takes effect)

  Then:  powershell -ExecutionPolicy Bypass -File .\scripts\smoke-doku-sandbox-checkout.ps1

  See docs/integrations/doku-checkout/sandbox-e2e.md for the full runbook,
  ngrok setup, DOKU dashboard Notification URL, and verification steps.
#>

$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001'
$pw   = 'Password123'

# helpers
function Body($o) { $o | ConvertTo-Json -Depth 8 }

function Psql([string]$sql) {
  (docker exec klab-postgres psql -U postgres -d klab_booking -t -A -c $sql).Trim()
}

function Register($email, $name, $phone) {
  try {
    Invoke-RestMethod -Method Post -Uri "$base/auth/register" -ContentType 'application/json' `
      -Body (Body @{ email = $email; password = $pw; full_name = $name; phone = $phone }) | Out-Null
  } catch { } # already registered -> ignore
}
function Login($email) {
  (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' `
      -Body (Body @{ email = $email; password = $pw })).data.access_token
}
function ApiPost($url, $token, $obj) {
  $h = @{}
  if ($token) { $h['Authorization'] = "Bearer $token" }
  $p = @{ Method = 'Post'; Uri = "$base$url"; Headers = $h; ContentType = 'application/json' }
  if ($null -ne $obj) { $p['Body'] = (Body $obj) }
  (Invoke-RestMethod @p).data
}

function Ok([string]$m)   { Write-Host "  PASS  $m" -ForegroundColor Green }
function Fail([string]$m) { Write-Host "  FAIL  $m" -ForegroundColor Red }
function Section([string]$t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

# 0. preflight
Section '0. Preflight'
try {
  Invoke-RestMethod -Method Get -Uri "$base/health" | Out-Null
  Ok "server reachable at $base"
} catch {
  Fail "server not reachable at $base - start it with: npm run start:dev"
  exit 1
}

# 1. accounts + bootstrap
Section '1. Accounts + bootstrap'
$run        = "$(Get-Date -Format 'yyyyMMddHHmmss')$(Get-Random -Maximum 9999)"
$ownerEmail = "sbxowner$run@klab.test"
$mEmail     = "sbxmember$run@klab.test"
$mPhone     = '08123456789'   # ensures DOKU customer.phone is populated

Register $ownerEmail 'Sandbox Owner' '08120000000'
Register $mEmail     'Sandbox Member' $mPhone
Psql "UPDATE users SET role_id = (SELECT id FROM roles WHERE name='owner') WHERE email='$ownerEmail'" | Out-Null
$owner = Login $ownerEmail
$tok   = Login $mEmail
Ok "registered sandbox owner/member (run=$run); member has email + phone"

# 2. ensure a published, active package exists
Section '2. Ensure published active package'
$pkg = ApiPost '/admin/packages' $owner @{
  name = "Sandbox Pack $run"; description = 'DOKU sandbox e2e package'
  price_idr = 150000; credit_amount = 5; is_unlimited = $false
  validity_days = 30; is_published = $true; status = 'active'
}
Ok "package id=$($pkg.id)  price_idr=$($pkg.price_idr)  credit_amount=$($pkg.credit_amount)"

# 3. real checkout
Section '3. POST /member/packages/:packageId/checkout (REAL DOKU sandbox)'
try {
  $checkout = ApiPost "/member/packages/$($pkg.id)/checkout" $tok $null
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Fail "checkout request failed (HTTP $status)."
  Write-Host ""
  Write-Host "  A 502 usually means DOKU rejected the create-payment request. Common causes:" -ForegroundColor Yellow
  Write-Host "   * DOKU_CLIENT_ID / DOKU_SECRET_KEY wrong or not a matched sandbox pair" -ForegroundColor Yellow
  Write-Host "   * DOKU_CALLBACK_URL / DOKU_RETURN_URL not accepted (use https public URLs)" -ForegroundColor Yellow
  Write-Host "   * amount below the channel minimum, or missing customer fields" -ForegroundColor Yellow
  Write-Host "  Check the server log for the 'DOKU checkout failed (...)' line for DOKU's message." -ForegroundColor Yellow
  Write-Host "  See docs/integrations/doku-checkout/sandbox-e2e.md (Troubleshooting)." -ForegroundColor Yellow
  exit 1
}

# Guard: detect mock mode. Mock checkout URLs always contain 'mock=1'.
if ([string]::IsNullOrEmpty($checkout.checkout_url) -or $checkout.checkout_url -match 'mock=1') {
  Fail "Server is running in DOKU_MOCK mode (got a mock checkout_url)."
  Write-Host "  Set DOKU_MOCK=false in your local .env and RESTART the server, then re-run." -ForegroundColor Yellow
  Write-Host "  Returned checkout_url: $($checkout.checkout_url)" -ForegroundColor Yellow
  exit 1
}

# Sanity: a real DOKU checkout URL should point at a doku.com host.
if ($checkout.checkout_url -notmatch 'doku\.com') {
  Write-Host "  WARN  checkout_url does not look like a DOKU host - verify DOKU_ENV/URL config:" -ForegroundColor Yellow
  Write-Host "        $($checkout.checkout_url)" -ForegroundColor Yellow
}

Ok "real DOKU checkout created (no mock)"

# 4. output (safe values only)
Section '4. Checkout result'
Write-Host "  payment_id   : $($checkout.payment_id)"
Write-Host "  payment_code : $($checkout.payment_code)"
Write-Host "  amount       : $($checkout.amount_idr) IDR"
Write-Host "  expired_at   : $($checkout.expired_at)"
Write-Host "  checkout_url : $($checkout.checkout_url)"

Section 'Next manual steps'
Write-Host "  1. Open the checkout_url above in a browser."
Write-Host "  2. Pay using a DOKU sandbox method (sandbox Virtual Account number, or the"
Write-Host "     DOKU payment simulator). No real money is moved in sandbox."
Write-Host "  3. For the server-to-server notification to reach this backend, DOKU must be"
Write-Host "     able to POST to a PUBLIC URL. Run an ngrok tunnel and set the DOKU dashboard"
Write-Host "     Notification URL to  https://<ngrok>/payments/doku/callback"
Write-Host "     (see docs/integrations/doku-checkout/sandbox-e2e.md)."
Write-Host "  4. After paying, verify activation with:"
Write-Host "       powershell -ExecutionPolicy Bypass -File .\scripts\verify-doku-payment.ps1 -PaymentCode $($checkout.payment_code)"
Write-Host "     Expected after a successful paid callback:"
Write-Host "       * payments.status        = paid"
Write-Host "       * doku_transactions      >= 1 row, signature_valid = t"
Write-Host "       * member_packages        = 1 row (status active)"
Write-Host "       * credit_ledger          = 1 package_purchase row"
Write-Host "       * members.credit_balance = $($pkg.credit_amount)"

Write-Host "`nSandbox checkout script complete (payment not yet completed, which is expected).`n" -ForegroundColor Cyan
