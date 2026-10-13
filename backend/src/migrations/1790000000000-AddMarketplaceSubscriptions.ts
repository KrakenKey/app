import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Microsoft Marketplace subscriptions (SaaS fulfillment API v2).
 *
 * Every change is additive so the previous release keeps working while both
 * run side by side during a deploy:
 * - `source` defaults to 'stripe', which is what every existing row is, and
 *   what rows inserted by the previous release get.
 * - The marketplace columns are nullable.
 * - `stripeCustomerId` becomes nullable: an account that only buys through
 *   Microsoft never gets a Stripe customer. The previous release only reads
 *   it for accounts that use Stripe, and never writes a null.
 *
 * `marketplace_operation` records each webhook operation that was handled,
 * so a redelivered webhook is acknowledged without being applied twice.
 */
export class AddMarketplaceSubscriptions1790000000000 implements MigrationInterface {
  name = 'AddMarketplaceSubscriptions1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscription"
        ALTER COLUMN "stripeCustomerId" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "subscription"
        ADD COLUMN IF NOT EXISTS "source" character varying NOT NULL DEFAULT 'stripe',
        ADD COLUMN IF NOT EXISTS "marketplaceSubscriptionId" character varying,
        ADD COLUMN IF NOT EXISTS "marketplaceOfferId" character varying,
        ADD COLUMN IF NOT EXISTS "marketplacePlanId" character varying,
        ADD COLUMN IF NOT EXISTS "marketplaceStatus" character varying,
        ADD COLUMN IF NOT EXISTS "marketplaceQuantity" integer
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_subscription_marketplaceSubscriptionId"
        ON "subscription" ("marketplaceSubscriptionId")
        WHERE "marketplaceSubscriptionId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_operation" (
        "id" character varying NOT NULL,
        "subscriptionId" character varying NOT NULL,
        "action" character varying NOT NULL,
        "result" character varying NOT NULL,
        "detail" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_operation" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_marketplace_operation_subscriptionId"
        ON "marketplace_operation" ("subscriptionId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dropping the columns would silently unlink subscriptions Microsoft
    // still bills for. Refuse while any exist.
    const rows = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM "subscription" WHERE "source" = 'marketplace'`,
    )) as { n: number }[];
    if ((rows[0]?.n ?? 0) > 0) {
      throw new Error(
        `Refusing to revert AddMarketplaceSubscriptions: ${rows[0].n} subscription(s) have source 'marketplace'. Move or delete them first.`,
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_operation"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_subscription_marketplaceSubscriptionId"`,
    );
    await queryRunner.query(`
      ALTER TABLE "subscription"
        DROP COLUMN IF EXISTS "marketplaceQuantity",
        DROP COLUMN IF EXISTS "marketplaceStatus",
        DROP COLUMN IF EXISTS "marketplacePlanId",
        DROP COLUMN IF EXISTS "marketplaceOfferId",
        DROP COLUMN IF EXISTS "marketplaceSubscriptionId",
        DROP COLUMN IF EXISTS "source"
    `);
    // Rows without a Stripe customer can't go back under NOT NULL; leave the
    // column nullable if any exist.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM "subscription" WHERE "stripeCustomerId" IS NULL) THEN
          ALTER TABLE "subscription" ALTER COLUMN "stripeCustomerId" SET NOT NULL;
        END IF;
      END $$
    `);
  }
}
