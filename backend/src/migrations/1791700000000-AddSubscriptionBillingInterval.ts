import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `billingInterval` records whether a Stripe subscription is billed monthly
 * or yearly, now that each plan has a price for both. Null on the free plan,
 * for Marketplace subscriptions and for existing rows (all monthly until
 * their next Stripe event fills it in).
 *
 * Additive only (a nullable column, no default, no rewrite), so the
 * previous release keeps working beside this one. lock_timeout keeps the
 * ALTER from queueing the previous release's writes behind a long wait.
 */
export class AddSubscriptionBillingInterval1791700000000 implements MigrationInterface {
  name = 'AddSubscriptionBillingInterval1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "subscription"
        ADD COLUMN IF NOT EXISTS "billingInterval" character varying(10)
    `);
  }

  /**
   * Not safe once yearly subscriptions exist: the previous release has no
   * yearly prices, so it maps them to no plan.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "subscription" DROP COLUMN IF EXISTS "billingInterval"
    `);
  }
}
