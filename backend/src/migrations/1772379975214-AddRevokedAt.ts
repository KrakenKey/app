import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRevokedAt1772379975214 implements MigrationInterface {
  name = 'AddRevokedAt1772379975214';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tls_crt" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tls_crt" DROP COLUMN IF EXISTS "revokedAt"`,
    );
  }
}
