import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `previousRawCsr` and `previousParsedCsr` keep the CSR of the current
 * certificate while a renewal with a new CSR is in flight, so a failed
 * renewal that keeps the certificate can restore the matching CSR.
 *
 * Additive only (nullable columns, no default, no rewrite), so the
 * previous release keeps working beside this one. lock_timeout keeps the
 * ALTER from queueing the previous release's writes behind a long wait.
 */
export class AddPreviousCsr1791400000000 implements MigrationInterface {
  name = 'AddPreviousCsr1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ADD COLUMN IF NOT EXISTS "previousRawCsr" VARCHAR,
        ADD COLUMN IF NOT EXISTS "previousParsedCsr" JSONB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        DROP COLUMN IF EXISTS "previousParsedCsr",
        DROP COLUMN IF EXISTS "previousRawCsr"
    `);
  }
}
