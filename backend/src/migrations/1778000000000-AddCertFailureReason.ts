import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCertFailureReason1778000000000 implements MigrationInterface {
  name = 'AddCertFailureReason1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ADD COLUMN IF NOT EXISTS "failureReason" TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        DROP COLUMN IF EXISTS "failureReason"
    `);
  }
}
