import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRenewalTracking1772290404590 implements MigrationInterface {
  name = 'AddRenewalTracking1772290404590';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tls_crt" ADD COLUMN IF NOT EXISTS "autoRenew" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "tls_crt" ADD COLUMN IF NOT EXISTS "renewalCount" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "tls_crt" ADD COLUMN IF NOT EXISTS "lastRenewalAttemptAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tls_crt" DROP COLUMN IF EXISTS "lastRenewalAttemptAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tls_crt" DROP COLUMN IF EXISTS "renewalCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tls_crt" DROP COLUMN IF EXISTS "autoRenew"`,
    );
  }
}
