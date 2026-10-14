import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `renewalFailedEmailAt` limits renewal-failed emails to one per
 * certificate per day, since a failing renewal close to expiry is retried
 * every few hours.
 *
 * Additive only (a nullable column, no default, no rewrite), so the
 * previous release keeps working beside this one. lock_timeout keeps the
 * ALTER from queueing the previous release's writes behind a long wait.
 */
export class AddRenewalFailedEmailAt1791500000000 implements MigrationInterface {
  name = 'AddRenewalFailedEmailAt1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ADD COLUMN IF NOT EXISTS "renewalFailedEmailAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt" DROP COLUMN IF EXISTS "renewalFailedEmailAt"
    `);
  }
}
