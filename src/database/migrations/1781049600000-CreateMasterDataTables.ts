import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMasterDataTables1781049600000 implements MigrationInterface {
  name = 'CreateMasterDataTables1781049600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "room_status_enum" AS ENUM ('active', 'inactive')`);

    await queryRunner.query(`
      CREATE TABLE "rooms" (
        "id"          uuid               NOT NULL DEFAULT gen_random_uuid(),
        "name"        character varying  NOT NULL,
        "description" character varying,
        "capacity"    integer            NOT NULL,
        "status"      "room_status_enum" NOT NULL DEFAULT 'active',
        "created_at"  TIMESTAMP          NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP          NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_rooms_name" UNIQUE ("name"),
        CONSTRAINT "PK_rooms_id"   PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE TYPE "instructor_status_enum" AS ENUM ('active', 'inactive')`);

    await queryRunner.query(`
      CREATE TABLE "instructors" (
        "id"             uuid                      NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        uuid,
        "first_name"     character varying         NOT NULL,
        "last_name"      character varying         NOT NULL,
        "email"          character varying         NOT NULL,
        "phone"          character varying,
        "bio"            text,
        "specialization" character varying,
        "status"         "instructor_status_enum"  NOT NULL DEFAULT 'active',
        "created_at"     TIMESTAMP                 NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP                 NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_instructors_email" UNIQUE ("email"),
        CONSTRAINT "PK_instructors_id"    PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "instructors"
        ADD CONSTRAINT "FK_instructors_user_id"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`CREATE TYPE "class_type_status_enum" AS ENUM ('active', 'inactive')`);

    await queryRunner.query(`
      CREATE TABLE "class_types" (
        "id"                uuid                      NOT NULL DEFAULT gen_random_uuid(),
        "name"              character varying         NOT NULL,
        "category"          character varying,
        "level"             character varying,
        "duration_minutes"  integer                   NOT NULL,
        "description"       text,
        "default_capacity"  integer                   NOT NULL,
        "default_price_idr" integer                   NOT NULL DEFAULT 0,
        "credit_cost"       integer                   NOT NULL DEFAULT 0,
        "image_url"         character varying,
        "is_published"      boolean                   NOT NULL DEFAULT false,
        "status"            "class_type_status_enum"  NOT NULL DEFAULT 'active',
        "created_at"        TIMESTAMP                 NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP                 NOT NULL DEFAULT now(),
        CONSTRAINT "PK_class_types_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE TYPE "package_status_enum" AS ENUM ('active', 'inactive')`);

    await queryRunner.query(`
      CREATE TABLE "packages" (
        "id"            uuid                   NOT NULL DEFAULT gen_random_uuid(),
        "name"          character varying      NOT NULL,
        "description"   text,
        "price_idr"     integer                NOT NULL DEFAULT 0,
        "credit_amount" integer                NOT NULL DEFAULT 0,
        "is_unlimited"  boolean                NOT NULL DEFAULT false,
        "validity_days" integer                NOT NULL,
        "is_published"  boolean                NOT NULL DEFAULT false,
        "status"        "package_status_enum"  NOT NULL DEFAULT 'active',
        "created_at"    TIMESTAMP              NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP              NOT NULL DEFAULT now(),
        CONSTRAINT "PK_packages_id" PRIMARY KEY ("id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "packages"`);
    await queryRunner.query(`DROP TYPE "package_status_enum"`);
    await queryRunner.query(`DROP TABLE "class_types"`);
    await queryRunner.query(`DROP TYPE "class_type_status_enum"`);
    await queryRunner.query(`ALTER TABLE "instructors" DROP CONSTRAINT "FK_instructors_user_id"`);
    await queryRunner.query(`DROP TABLE "instructors"`);
    await queryRunner.query(`DROP TYPE "instructor_status_enum"`);
    await queryRunner.query(`DROP TABLE "rooms"`);
    await queryRunner.query(`DROP TYPE "room_status_enum"`);
  }
}
