import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRbacTables1780963200000 implements MigrationInterface {
  name = 'CreateRbacTables1780963200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "users_status_enum" AS ENUM ('active', 'inactive', 'suspended')`,
    );

    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id"          uuid              NOT NULL DEFAULT gen_random_uuid(),
        "name"        character varying NOT NULL,
        "description" character varying,
        "is_system"   boolean           NOT NULL DEFAULT false,
        "created_at"  TIMESTAMP         NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_roles_name" UNIQUE ("name"),
        CONSTRAINT "PK_roles_id"   PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id"          uuid              NOT NULL DEFAULT gen_random_uuid(),
        "action"      character varying NOT NULL,
        "description" character varying,
        "created_at"  TIMESTAMP         NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_permissions_action" UNIQUE ("action"),
        CONSTRAINT "PK_permissions_id"     PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            uuid                NOT NULL DEFAULT gen_random_uuid(),
        "email"         character varying   NOT NULL,
        "phone"         character varying,
        "password_hash" character varying   NOT NULL,
        "full_name"     character varying   NOT NULL,
        "status"        "users_status_enum" NOT NULL DEFAULT 'active',
        "role_id"       uuid,
        "created_at"    TIMESTAMP           NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP           NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users_id"    PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_role_id"
        FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "id"            uuid      NOT NULL DEFAULT gen_random_uuid(),
        "role_id"       uuid      NOT NULL,
        "permission_id" uuid      NOT NULL,
        "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_role_permissions_pair" UNIQUE ("role_id", "permission_id"),
        CONSTRAINT "PK_role_permissions_id"   PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "role_permissions"
        ADD CONSTRAINT "FK_role_permissions_role_id"
        FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "role_permissions"
        ADD CONSTRAINT "FK_role_permissions_permission_id"
        FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_role_permissions_permission_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_role_permissions_role_id"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_role_id"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TYPE "users_status_enum"`);
  }
}
