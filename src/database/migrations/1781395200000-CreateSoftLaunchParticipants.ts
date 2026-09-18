import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSoftLaunchParticipants1781395200000 implements MigrationInterface {
  name = 'CreateSoftLaunchParticipants1781395200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── soft_launch_participants ───────────────────────────────────────────
    // One row per user granted soft-launch booking eligibility. Rows are written
    // once and never updated or deleted (audit/history). Eligibility is keyed to
    // users.id because registration creates the user before any members row.
    //
    // Quota (COUNT <= SOFT_LAUNCH_QUOTA) is enforced in the allocator under a
    // pg_advisory_xact_lock; UQ slot_no is the backstop so a non-serialised
    // allocation can only fail loudly, never silently exceed the quota.
    await queryRunner.query(`
      CREATE TABLE "soft_launch_participants" (
        "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"      uuid                     NOT NULL,
        "code"         character varying(20)    NOT NULL,
        "slot_no"      smallint                 NOT NULL,
        "source"       character varying        NOT NULL,
        "allocated_by" uuid,
        "allocated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_soft_launch_participants_id"      PRIMARY KEY ("id"),
        CONSTRAINT "UQ_soft_launch_participants_user_id" UNIQUE ("user_id"),
        CONSTRAINT "UQ_soft_launch_participants_code"    UNIQUE ("code"),
        CONSTRAINT "UQ_soft_launch_participants_slot_no" UNIQUE ("slot_no"),
        CONSTRAINT "CHK_soft_launch_participants_slot_no_positive" CHECK ("slot_no" >= 1)
      )
    `);
    // RESTRICT: a user holding a soft-launch slot cannot be hard-deleted (audit).
    await queryRunner.query(`
      ALTER TABLE "soft_launch_participants"
        ADD CONSTRAINT "FK_soft_launch_participants_user_id"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "soft_launch_participants"
        ADD CONSTRAINT "FK_soft_launch_participants_allocated_by"
        FOREIGN KEY ("allocated_by") REFERENCES "users"("id") ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "soft_launch_participants"`);
  }
}
