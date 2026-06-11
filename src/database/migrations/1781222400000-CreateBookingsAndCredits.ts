import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBookingsAndCredits1781222400000 implements MigrationInterface {
  name = 'CreateBookingsAndCredits1781222400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ──────────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TYPE "member_status_enum" AS ENUM ('active', 'inactive', 'suspended')`,
    );
    await queryRunner.query(
      `CREATE TYPE "member_package_status_enum" AS ENUM ('active', 'expired', 'depleted', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "booking_status_enum" AS ENUM ('pending_payment', 'confirmed', 'waitlisted', 'cancelled', 'completed', 'no_show')`,
    );
    await queryRunner.query(
      `CREATE TYPE "attendance_status_enum" AS ENUM ('not_checked_in', 'checked_in', 'no_show')`,
    );
    await queryRunner.query(
      `CREATE TYPE "credit_ledger_type_enum" AS ENUM ('package_purchase', 'booking_debit', 'cancellation_refund', 'manual_adjustment', 'expiry', 'no_show_forfeit')`,
    );

    // ── members ────────────────────────────────────────────────────────────
    // Business/customer identity. Distinct from users (auth/login identity).
    // credit_balance is the canonical credit balance; credit_ledger is the audit trail.
    await queryRunner.query(`
      CREATE TABLE "members" (
        "id"             uuid                 NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        uuid,
        "first_name"     character varying,
        "last_name"      character varying,
        "email"          character varying,
        "phone"          character varying,
        "notes"          text,
        "status"         "member_status_enum" NOT NULL DEFAULT 'active',
        "credit_balance" integer              NOT NULL DEFAULT 0,
        "created_at"     TIMESTAMP            NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP            NOT NULL DEFAULT now(),
        CONSTRAINT "PK_members_id"      PRIMARY KEY ("id"),
        CONSTRAINT "UQ_members_user_id" UNIQUE ("user_id"),
        CONSTRAINT "CHK_members_credit_balance_nonneg" CHECK ("credit_balance" >= 0)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "members"
        ADD CONSTRAINT "FK_members_user_id"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // ── member_packages ────────────────────────────────────────────────────
    // Created for ERD fidelity and the future Payments slice. NOT populated here.
    await queryRunner.query(`
      CREATE TABLE "member_packages" (
        "id"                uuid                         NOT NULL DEFAULT gen_random_uuid(),
        "member_id"         uuid                         NOT NULL,
        "package_id"        uuid,
        "payment_id"        uuid,
        "start_date"        TIMESTAMP WITH TIME ZONE,
        "expiry_date"       TIMESTAMP WITH TIME ZONE,
        "credits_total"     integer                      NOT NULL DEFAULT 0,
        "credits_remaining" integer                      NOT NULL DEFAULT 0,
        "status"            "member_package_status_enum" NOT NULL DEFAULT 'active',
        "created_at"        TIMESTAMP                    NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP                    NOT NULL DEFAULT now(),
        CONSTRAINT "PK_member_packages_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "member_packages"
        ADD CONSTRAINT "FK_member_packages_member_id"
        FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE
    `);
    // package_id references the existing packages table (payment_id stays FK-less for now).
    await queryRunner.query(`
      ALTER TABLE "member_packages"
        ADD CONSTRAINT "FK_member_packages_package_id"
        FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_member_packages_member_status" ON "member_packages" ("member_id", "status")`,
    );

    // ── bookings ───────────────────────────────────────────────────────────
    // credit_ledger_id FK is added after credit_ledger exists (circular reference).
    await queryRunner.query(`
      CREATE TABLE "bookings" (
        "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "booking_code"      character varying        NOT NULL,
        "member_id"         uuid                     NOT NULL,
        "schedule_id"       uuid                     NOT NULL,
        "status"            "booking_status_enum"    NOT NULL DEFAULT 'confirmed',
        "attendance_status" "attendance_status_enum" NOT NULL DEFAULT 'not_checked_in',
        "source"            character varying        NOT NULL DEFAULT 'member',
        "credit_cost"       integer                  NOT NULL DEFAULT 0,
        "credit_ledger_id"  uuid,
        "payment_id"        uuid,
        "waitlist_position" integer,
        "created_at"        TIMESTAMP                NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP                NOT NULL DEFAULT now(),
        "cancelled_at"      TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_bookings_id"           PRIMARY KEY ("id"),
        CONSTRAINT "UQ_bookings_booking_code" UNIQUE ("booking_code")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD CONSTRAINT "FK_bookings_member_id"
        FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD CONSTRAINT "FK_bookings_schedule_id"
        FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_bookings_schedule_status" ON "bookings" ("schedule_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bookings_member_status" ON "bookings" ("member_id", "status")`,
    );
    // Hard guarantee against duplicate active bookings for the same member + schedule,
    // even under concurrent requests. Cancelled/completed/no_show are excluded.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UX_bookings_active_member_schedule"
        ON "bookings" ("member_id", "schedule_id")
        WHERE "status" IN ('pending_payment', 'confirmed', 'waitlisted')
    `);

    // ── credit_ledger ──────────────────────────────────────────────────────
    // Immutable audit trail. amount is signed: debit < 0, refund/top-up > 0.
    await queryRunner.query(`
      CREATE TABLE "credit_ledger" (
        "id"                uuid                      NOT NULL DEFAULT gen_random_uuid(),
        "member_id"         uuid                      NOT NULL,
        "member_package_id" uuid,
        "booking_id"        uuid,
        "type"              "credit_ledger_type_enum" NOT NULL,
        "amount"            integer                   NOT NULL,
        "balance_after"     integer                   NOT NULL,
        "reason"            character varying,
        "created_by"        uuid,
        "created_at"        TIMESTAMP                 NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_ledger_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "credit_ledger"
        ADD CONSTRAINT "FK_credit_ledger_member_id"
        FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "credit_ledger"
        ADD CONSTRAINT "FK_credit_ledger_member_package_id"
        FOREIGN KEY ("member_package_id") REFERENCES "member_packages"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "credit_ledger"
        ADD CONSTRAINT "FK_credit_ledger_booking_id"
        FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "credit_ledger"
        ADD CONSTRAINT "FK_credit_ledger_created_by"
        FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_credit_ledger_member_created" ON "credit_ledger" ("member_id", "created_at")`,
    );

    // ── circular FK: bookings.credit_ledger_id → credit_ledger.id ──────────
    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD CONSTRAINT "FK_bookings_credit_ledger_id"
        FOREIGN KEY ("credit_ledger_id") REFERENCES "credit_ledger"("id") ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings" DROP CONSTRAINT "FK_bookings_credit_ledger_id"`,
    );
    await queryRunner.query(`DROP TABLE "credit_ledger"`);
    await queryRunner.query(`DROP TABLE "bookings"`);
    await queryRunner.query(`DROP TABLE "member_packages"`);
    await queryRunner.query(`DROP TABLE "members"`);
    await queryRunner.query(`DROP TYPE "credit_ledger_type_enum"`);
    await queryRunner.query(`DROP TYPE "attendance_status_enum"`);
    await queryRunner.query(`DROP TYPE "booking_status_enum"`);
    await queryRunner.query(`DROP TYPE "member_package_status_enum"`);
    await queryRunner.query(`DROP TYPE "member_status_enum"`);
  }
}
