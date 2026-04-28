import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActivationTracking1776000000000 implements MigrationInterface {
  name = 'AddActivationTracking1776000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
        ADD COLUMN IF NOT EXISTS "firstDomainAddedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "firstCertIssuedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "onboardingEmailSentAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
        DROP COLUMN IF EXISTS "firstDomainAddedAt",
        DROP COLUMN IF EXISTS "firstCertIssuedAt",
        DROP COLUMN IF EXISTS "onboardingEmailSentAt"
    `);
  }
}
