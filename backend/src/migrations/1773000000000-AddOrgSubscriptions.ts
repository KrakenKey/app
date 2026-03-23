import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrgSubscriptions1773000000000 implements MigrationInterface {
  name = 'AddOrgSubscriptions1773000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Add organizationId to subscription ────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "subscription"
        ADD COLUMN IF NOT EXISTS "organizationId" uuid NULL DEFAULT NULL
    `);

    // ── Make userId nullable ──────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "subscription"
        ALTER COLUMN "userId" DROP NOT NULL
    `);

    // ── Drop old unique constraint on userId ──────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "subscription"
        DROP CONSTRAINT IF EXISTS "UQ_subscription_userId"
    `);

    // ── Partial unique index: one subscription per user (when not null) ───
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_subscription_userId_partial"
        ON "subscription" ("userId")
        WHERE "userId" IS NOT NULL
    `);

    // ── Partial unique index: one subscription per org (when not null) ────
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_subscription_organizationId_partial"
        ON "subscription" ("organizationId")
        WHERE "organizationId" IS NOT NULL
    `);

    // ── FK: subscription.organizationId → organization.id ─────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_subscription_organizationId'
        ) THEN
          ALTER TABLE "subscription"
            ADD CONSTRAINT "FK_subscription_organizationId"
            FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
            ON DELETE CASCADE;
        END IF;
      END $$
    `);

    // ── CHECK: exactly one of userId/organizationId must be non-null ──────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_subscription_owner'
        ) THEN
          ALTER TABLE "subscription"
            ADD CONSTRAINT "CHK_subscription_owner"
            CHECK (
              ("userId" IS NOT NULL AND "organizationId" IS NULL) OR
              ("userId" IS NULL AND "organizationId" IS NOT NULL)
            );
        END IF;
      END $$
    `);

    // ── Index on organizationId for lookups ────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscription_organizationId"
        ON "subscription" ("organizationId")
    `);

    // ── Drop plan column from organization (subscription is source of truth)
    await queryRunner.query(`
      ALTER TABLE "organization"
        DROP COLUMN IF EXISTS "plan"
    `);

    // ── Add status column to organization ─────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "organization"
        ADD COLUMN IF NOT EXISTS "status" varchar NOT NULL DEFAULT 'active'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop status column
    await queryRunner.query(`
      ALTER TABLE "organization"
        DROP COLUMN IF EXISTS "status"
    `);

    // Restore organization.plan column
    await queryRunner.query(`
      ALTER TABLE "organization"
        ADD COLUMN IF NOT EXISTS "plan" varchar NOT NULL DEFAULT 'free'
    `);

    // Drop check constraint
    await queryRunner.query(`
      ALTER TABLE "subscription"
        DROP CONSTRAINT IF EXISTS "CHK_subscription_owner"
    `);

    // Drop FK
    await queryRunner.query(`
      ALTER TABLE "subscription"
        DROP CONSTRAINT IF EXISTS "FK_subscription_organizationId"
    `);

    // Drop indexes
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_organizationId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_subscription_organizationId_partial"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_subscription_userId_partial"`,
    );

    // Restore original unique constraint on userId
    await queryRunner.query(`
      ALTER TABLE "subscription"
        ADD CONSTRAINT "UQ_subscription_userId" UNIQUE ("userId")
    `);

    // Make userId NOT NULL again
    await queryRunner.query(`
      ALTER TABLE "subscription"
        ALTER COLUMN "userId" SET NOT NULL
    `);

    // Drop organizationId column
    await queryRunner.query(`
      ALTER TABLE "subscription"
        DROP COLUMN IF EXISTS "organizationId"
    `);
  }
}
