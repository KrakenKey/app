import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan ids are now free, pro, business and enterprise: Starter became Pro
 * and Team became Business (the free plan keeps the id `free` and is shown
 * as "Starter").
 *
 * Safe beside the previous release during a deploy. That release doesn't
 * know `pro` and reads it as Free for limits and rate limits until it stops,
 * which can refuse a new resource for a minute but changes no data: its
 * scan-result cleanup only deletes for `free` and `starter`, and its org
 * dissolution only follows a Stripe or Marketplace plan change. It knows
 * `business`. Rows it writes in that window with `starter` or `team` are
 * read as `pro` and `business` by this release (normalizePlan), and are
 * rewritten on the next Stripe event for them.
 *
 * Only `plan` values change (no DDL); lock_timeout keeps the UPDATE from
 * waiting long on row locks the previous release holds.
 */
export class RenamePlansToProAndBusiness1791600000000 implements MigrationInterface {
  name = 'RenamePlansToProAndBusiness1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `UPDATE "subscription" SET "plan" = 'pro' WHERE "plan" = 'starter'`,
    );
    await queryRunner.query(
      `UPDATE "subscription" SET "plan" = 'business' WHERE "plan" = 'team'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `business` rows can't be told apart from former Team rows, and the
    // previous release supports `business`, so only Pro goes back.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `UPDATE "subscription" SET "plan" = 'starter' WHERE "plan" = 'pro'`,
    );
  }
}
