import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ACME Renewal Information (RFC 9773) state per certificate. All nullable:
 * existing certificates get their identifier on the first ARI check.
 */
export class AddCertRenewalInfo1781000000000 implements MigrationInterface {
  name = 'AddCertRenewalInfo1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ADD COLUMN IF NOT EXISTS "ariCertId" TEXT,
        ADD COLUMN IF NOT EXISTS "ariWindowStart" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "ariWindowEnd" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "ariExplanationUrl" TEXT,
        ADD COLUMN IF NOT EXISTS "ariNextCheckAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "ariReplacementRequestedAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        DROP COLUMN IF EXISTS "ariReplacementRequestedAt",
        DROP COLUMN IF EXISTS "ariNextCheckAt",
        DROP COLUMN IF EXISTS "ariExplanationUrl",
        DROP COLUMN IF EXISTS "ariWindowEnd",
        DROP COLUMN IF EXISTS "ariWindowStart",
        DROP COLUMN IF EXISTS "ariCertId"
    `);
  }
}
