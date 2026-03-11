import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRBAC1772900000000 implements MigrationInterface {
  name = 'AddRBAC1772900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── organization table ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization" (
        "id"        uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "name"      varchar     NOT NULL,
        "ownerId"   text        NOT NULL,
        "plan"      varchar     NOT NULL DEFAULT 'free',
        "createdAt" TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organization_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_org_ownerId"
        ON "organization" ("ownerId")
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_organization_ownerId'
        ) THEN
          ALTER TABLE "organization"
            ADD CONSTRAINT "FK_organization_ownerId"
            FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE;
        END IF;
      END $$
    `);

    // ── user table: add role + organizationId ────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "user"
        ADD COLUMN IF NOT EXISTS "role"           varchar NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "organizationId" uuid    NULL DEFAULT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_organizationId"
        ON "user" ("organizationId")
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_user_organizationId'
        ) THEN
          ALTER TABLE "user"
            ADD CONSTRAINT "FK_user_organizationId"
            FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
            ON DELETE SET NULL;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "FK_user_organizationId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_organizationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "organizationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organization" DROP CONSTRAINT IF EXISTS "FK_organization_ownerId"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_org_ownerId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organization"`);
  }
}
