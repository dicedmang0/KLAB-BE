<#
  Verify the state of a DOKU payment after a callback (KLAB BE).

  Reads the database directly (via the klab-postgres container) and prints every
  artifact tied to a payment_code:
    * payments row
    * doku_transactions rows
    * member_packages row
    * credit_ledger package_purchase row(s)
    * member credit_balance

  Usage (from repo root):
    powershell -ExecutionPolicy Bypass -File .\scripts\verify-doku-payment.ps1 -PaymentCode INV-XXXXXXXX

  This is read-only. It does NOT touch DOKU and uses no DOKU credentials.
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$PaymentCode
)

$ErrorActionPreference = 'Stop'

# Run a query with an aligned table layout + header for readability.
function PsqlTable([string]$sql) {
  docker exec klab-postgres psql -U postgres -d klab_booking -c $sql
}
# Single scalar value (tuples-only, unaligned).
function PsqlScalar([string]$sql) {
  (docker exec klab-postgres psql -U postgres -d klab_booking -t -A -c $sql).Trim()
}

function Section([string]$t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

# Guard against SQL-quote breakage in the parameter.
$code = $PaymentCode.Replace("'", "''")

Write-Host "Verifying payment_code = $PaymentCode" -ForegroundColor White

# exists?
$paymentId = PsqlScalar "SELECT id FROM payments WHERE payment_code='$code'"
if ([string]::IsNullOrEmpty($paymentId)) {
  Write-Host "`nNo payment found for payment_code '$PaymentCode'." -ForegroundColor Red
  Write-Host "Check the code, or run the sandbox checkout script first." -ForegroundColor Yellow
  exit 1
}

# 1. payment row
Section '1. payments'
PsqlTable "SELECT id, payment_code, status, amount_idr, method, gateway, external_reference, paid_at, expired_at, created_at FROM payments WHERE payment_code='$code';"

# 2. doku_transactions (all callbacks for this order)
Section '2. doku_transactions (all callbacks for this order)'
PsqlTable "SELECT id, callback_status, signature_valid, amount_idr, method, transaction_date, received_at, reconciled_at FROM doku_transactions WHERE order_id='$code' ORDER BY received_at;"

# 3. member_packages (activated by this payment)
Section '3. member_packages (activated by this payment)'
PsqlTable "SELECT mp.id, mp.status, mp.credits_total, mp.credits_remaining, mp.start_date, mp.expiry_date, mp.created_at FROM member_packages mp JOIN payments p ON mp.payment_id = p.id WHERE p.payment_code='$code';"

# 4. credit_ledger package_purchase rows for this payment's member
Section '4. credit_ledger (package_purchase rows for this member)'
PsqlTable "SELECT cl.id, cl.type, cl.amount, cl.balance_after, cl.reason, cl.created_at FROM credit_ledger cl JOIN payments p ON cl.member_id = p.member_id WHERE p.payment_code='$code' AND cl.type='package_purchase' ORDER BY cl.created_at;"

# 5. member credit_balance
Section '5. member credit_balance'
PsqlTable "SELECT m.id AS member_id, m.email, m.credit_balance FROM members m JOIN payments p ON m.id = p.member_id WHERE p.payment_code='$code';"

# summary
$payStatus = PsqlScalar "SELECT status FROM payments WHERE payment_code='$code'"
$mpCount   = PsqlScalar "SELECT count(*) FROM member_packages mp JOIN payments p ON mp.payment_id=p.id WHERE p.payment_code='$code'"
$plCount   = PsqlScalar "SELECT count(*) FROM credit_ledger cl JOIN payments p ON cl.member_id=p.member_id WHERE p.payment_code='$code' AND cl.type='package_purchase'"

Section 'Summary'
Write-Host "  payment status            : $payStatus"
Write-Host "  member_packages activated : $mpCount"
Write-Host "  package_purchase ledgers  : $plCount"
if ($payStatus -eq 'paid' -and $mpCount -eq '1' -and $plCount -eq '1') {
  Write-Host "  => Activation looks correct (paid, 1 member_package, 1 ledger row)." -ForegroundColor Green
} elseif ($payStatus -eq 'pending') {
  Write-Host "  => Still pending. Payment not completed or callback not received yet." -ForegroundColor Yellow
} else {
  Write-Host "  => Review the rows above against the expected activation state." -ForegroundColor Yellow
}
Write-Host ""
