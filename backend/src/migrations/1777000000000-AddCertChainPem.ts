import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCertChainPem1777000000000 implements MigrationInterface {
  name = 'AddCertChainPem1777000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ADD COLUMN IF NOT EXISTS "chainPem" TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        DROP COLUMN IF EXISTS "chainPem"
    `);
  }
}
