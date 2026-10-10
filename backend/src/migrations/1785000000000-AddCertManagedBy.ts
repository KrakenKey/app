import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who renews a certificate: 'connector' for a customer-hosted connector that
 * keeps the private key, null for KrakenKey's own renewal. Nullable, so
 * existing certificates keep server-side renewal.
 */
export class AddCertManagedBy1785000000000 implements MigrationInterface {
  name = 'AddCertManagedBy1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ADD COLUMN IF NOT EXISTS "managedBy" TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        DROP COLUMN IF EXISTS "managedBy"
    `);
  }
}
