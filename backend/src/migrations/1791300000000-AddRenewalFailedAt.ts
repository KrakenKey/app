import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `renewalFailedAt` records a renewal that failed while the current
 * certificate was still valid: the certificate stays issued with its PEM,
 * and automatic renewal waits before trying again.
 *
 * Additive only (a nullable column, no default, no rewrite), so the
 * previous release keeps working beside this one. lock_timeout keeps the
 * ALTER from queueing the previous release's writes behind a long wait.
 */
export class AddRenewalFailedAt1791300000000 implements MigrationInterface {
  name = 'AddRenewalFailedAt1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ADD COLUMN IF NOT EXISTS "renewalFailedAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt" DROP COLUMN IF EXISTS "renewalFailedAt"
    `);
  }
}
