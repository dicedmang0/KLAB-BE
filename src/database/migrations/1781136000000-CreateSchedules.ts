import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSchedules1781136000000 implements MigrationInterface {
  name = 'CreateSchedules1781136000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "schedule_status_enum" AS ENUM ('draft', 'published', 'cancelled', 'completed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "schedules" (
        "id"               uuid                    NOT NULL DEFAULT gen_random_uuid(),
        "class_type_id"    uuid                    NOT NULL,
        "instructor_id"    uuid                    NOT NULL,
        "room_id"          uuid                    NOT NULL,
        "start_time"       TIMESTAMP WITH TIME ZONE NOT NULL,
        "end_time"         TIMESTAMP WITH TIME ZONE NOT NULL,
        "capacity"         integer                 NOT NULL,
        "status"           "schedule_status_enum"  NOT NULL DEFAULT 'draft',
        "is_published"     boolean                 NOT NULL DEFAULT false,
        "recurrence_rule"  character varying,
        "created_by"       uuid,
        "created_at"       TIMESTAMP               NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMP               NOT NULL DEFAULT now(),
        CONSTRAINT "PK_schedules_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "schedules"
        ADD CONSTRAINT "FK_schedules_class_type_id"
        FOREIGN KEY ("class_type_id") REFERENCES "class_types"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "schedules"
        ADD CONSTRAINT "FK_schedules_instructor_id"
        FOREIGN KEY ("instructor_id") REFERENCES "instructors"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "schedules"
        ADD CONSTRAINT "FK_schedules_room_id"
        FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "schedules"
        ADD CONSTRAINT "FK_schedules_created_by"
        FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // ERD-recommended indexes for booking double-booking queries
    await queryRunner.query(
      `CREATE INDEX "IDX_schedules_start_end" ON "schedules" ("start_time", "end_time")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_schedules_instructor_start" ON "schedules" ("instructor_id", "start_time")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_schedules_room_start" ON "schedules" ("room_id", "start_time")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_schedules_room_start"`);
    await queryRunner.query(`DROP INDEX "IDX_schedules_instructor_start"`);
    await queryRunner.query(`DROP INDEX "IDX_schedules_start_end"`);
    await queryRunner.query(`ALTER TABLE "schedules" DROP CONSTRAINT "FK_schedules_created_by"`);
    await queryRunner.query(`ALTER TABLE "schedules" DROP CONSTRAINT "FK_schedules_room_id"`);
    await queryRunner.query(`ALTER TABLE "schedules" DROP CONSTRAINT "FK_schedules_instructor_id"`);
    await queryRunner.query(`ALTER TABLE "schedules" DROP CONSTRAINT "FK_schedules_class_type_id"`);
    await queryRunner.query(`DROP TABLE "schedules"`);
    await queryRunner.query(`DROP TYPE "schedule_status_enum"`);
  }
}
