import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pending certificates: a certificate created from a list of names, waiting
 * for a connector to send a CSR made with its own key (status
 * 'awaiting_csr'). Until then it has no CSR, so rawCsr and parsedCsr become
 * nullable, and requestedNames records the names it was created with.
 *
 * The status column is plain text, so the new status needs no schema change.
 */
export class AddPendingCertificates1787000000000 implements MigrationInterface {
  name = 'AddPendingCertificates1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ALTER COLUMN "rawCsr" DROP NOT NULL,
        ALTER COLUMN "parsedCsr" DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS "requestedNames" TEXT[]
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Certificates still waiting for a CSR can't satisfy NOT NULL; they never
    // reached the CA, so dropping them loses no issued certificate.
    await queryRunner.query(`
      DELETE FROM "tls_crt"
        WHERE "rawCsr" IS NULL OR "parsedCsr" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ALTER COLUMN "rawCsr" SET NOT NULL,
        ALTER COLUMN "parsedCsr" SET NOT NULL,
        DROP COLUMN IF EXISTS "requestedNames"
    `);
  }
}
