import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Grace period for failed payments: pastDueSince records when the first
 * payment of a past_due run failed, so the paid plan can keep applying for
 * 14 days while Stripe retries the charge. Null for every subscription that
 * is not past_due. Existing past_due rows are left null; the next Stripe
 * event for them (a retry failing or the subscription updating) sets it.
 */
export class AddSubscriptionPastDueSince1789000000000 implements MigrationInterface {
  name = 'AddSubscriptionPastDueSince1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscription"
        ADD COLUMN IF NOT EXISTS "pastDueSince" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscription"
        DROP COLUMN IF EXISTS "pastDueSince"
    `);
  }
}
