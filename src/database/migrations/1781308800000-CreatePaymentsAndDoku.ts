import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentsAndDoku1781308800000 implements MigrationInterface {
  name = 'CreatePaymentsAndDoku1781308800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum ───────────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "payment_status_enum" AS ENUM ('pending', 'paid', 'failed', 'expired', 'refunded')`,
    );

    // ── payments ───────────────────────────────────────────────────────────
    // Internal payment record. Created as 'pending' BEFORE calling DOKU; only a
    // verified paid callback flips it to 'paid' and activates a member_package.
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id"                 uuid                  NOT NULL DEFAULT gen_random_uuid(),
        "payment_code"       character varying     NOT NULL,
        "member_id"          uuid                  NOT NULL,
        "package_id"         uuid,
        "amount_idr"         integer               NOT NULL,
        "method"             character varying,
        "gateway"            character varying     NOT NULL DEFAULT 'doku',
        "status"             "payment_status_enum" NOT NULL DEFAULT 'pending',
        "external_reference" character varying,
        "checkout_url"       text,
        "request_id"         character varying,
        "paid_at"            TIMESTAMP WITH TIME ZONE,
        "expired_at"         TIMESTAMP WITH TIME ZONE,
        "created_at"         TIMESTAMP             NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP             NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments_id"           PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payments_payment_code" UNIQUE ("payment_code")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "payments"
        ADD CONSTRAINT "FK_payments_member_id"
        FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "payments"
        ADD CONSTRAINT "FK_payments_package_id"
        FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_status_created" ON "payments" ("status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_external_reference" ON "payments" ("external_reference")`,
    );

    // ── doku_transactions ──────────────────────────────────────────────────
    // Audit log of every DOKU callback. payment_id is nullable so a callback for
    // an unknown invoice (or with an invalid signature) is still recorded.
    await queryRunner.query(`
      CREATE TABLE "doku_transactions" (
        "id"               uuid       NOT NULL DEFAULT gen_random_uuid(),
        "payment_id"       uuid,
        "doku_reference"   character varying,
        "order_id"         character varying,
        "amount_idr"       integer,
        "method"           character varying,
        "transaction_date" TIMESTAMP WITH TIME ZONE,
        "callback_status"  character varying,
        "raw_payload"      jsonb      NOT NULL,
        "signature_valid"  boolean    NOT NULL DEFAULT false,
        "received_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "reconciled_at"    TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_doku_transactions_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "doku_transactions"
        ADD CONSTRAINT "FK_doku_transactions_payment_id"
        FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_doku_transactions_doku_reference" ON "doku_transactions" ("doku_reference")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_doku_transactions_order_id" ON "doku_transactions" ("order_id")`,
    );

    // ── member_packages.payment_id → payments (FK + idempotency backstop) ────
    // The column already exists (created FK-less for ERD fidelity). Now that
    // payments exists, wire the FK and add a partial unique index so a duplicate
    // paid callback can NEVER create a second member_package for the same payment.
    await queryRunner.query(`
      ALTER TABLE "member_packages"
        ADD CONSTRAINT "FK_member_packages_payment_id"
        FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UX_member_packages_payment_id"
        ON "member_packages" ("payment_id")
        WHERE "payment_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UX_member_packages_payment_id"`);
    await queryRunner.query(
      `ALTER TABLE "member_packages" DROP CONSTRAINT "FK_member_packages_payment_id"`,
    );
    await queryRunner.query(`DROP TABLE "doku_transactions"`);
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TYPE "payment_status_enum"`);
  }
}
