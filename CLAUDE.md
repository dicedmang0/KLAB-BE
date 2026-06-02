# KLAB Booking Engine — Backend Claude Rules

## Repository Scope

This repository is only for the Backend API.

Stack:

* NestJS
* TypeScript
* PostgreSQL
* DTO validation
* Role-based access control
* Payment/DOKU integration

## Source Documents

Before coding, always read:

* docs/01-product-prd.md
* docs/02-database-erd.md
* docs/03-backend-nestjs.md
* docs/05-qa-deployment.md
* docs/06-workflow.md

## Do Not Touch

* Do not modify frontend repositories.
* Do not create UI files.
* Do not invent product requirements outside the PRD.
* Do not change booking, credit, cancellation, waitlist, or payment rules without asking first.
* Do not hardcode secrets.

## Backend Priorities

1. Keep modules domain-based.
2. Use DTO validation.
3. Use guards for auth and permissions.
4. Keep booking and credit logic transactional.
5. Make DOKU callback idempotent.
6. Always write audit logs for critical admin actions.
7. Update `.env.example` when adding new environment variables.

## DOKU Checkout Integration

This project uses DOKU Checkout, not Direct API.

Before implementing DOKU payment logic, read:
- docs/integrations/doku-checkout/README.md
- docs/integrations/doku-checkout/doku-checkout-reference.md

Rules:
1. Create payment through backend only.
2. Frontend must never receive DOKU secret key.
3. Backend must generate DOKU headers and signature.
4. Backend must store internal payment before calling DOKU.
5. Backend must return DOKU `payment.url` to frontend.
6. Callback processing must be idempotent.
7. Payment success must activate package and credit only once.
8. Invalid callback/signature must not activate package.
9. Store raw callback payload in `doku_transactions.raw_payload`.

## Critical Business Rules

1. Confirmed booking must not exceed schedule capacity.
2. Booking creation and credit deduction must be atomic.
3. Duplicate DOKU callback must not activate package twice.
4. Cancellation before the valid window refunds credit.
5. Late cancellation and no-show do not refund credit.
6. Manual credit adjustment must require a reason and audit log.

## Workflow

Before editing files:

1. Explain the plan.
2. List files that will be created or updated.
3. Ask for approval if the task is large.

After editing:

1. Provide test command.
2. Provide build command.
3. Summarize changed files.
