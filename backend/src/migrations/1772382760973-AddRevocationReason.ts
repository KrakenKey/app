import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRevocationReason1772382760973 implements MigrationInterface {
  name = 'AddRevocationReason1772382760973';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tls_crt" ADD COLUMN IF NOT EXISTS "revocationReason" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tls_crt" DROP COLUMN IF EXISTS "revocationReason"`,
    );
  }
}
