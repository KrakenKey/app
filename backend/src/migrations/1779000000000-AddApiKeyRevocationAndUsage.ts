import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApiKeyRevocationAndUsage1779000000000 implements MigrationInterface {
  name = 'AddApiKeyRevocationAndUsage1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_api_key"
        ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "lastUsedIp" TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_api_key"
        DROP COLUMN IF EXISTS "lastUsedIp",
        DROP COLUMN IF EXISTS "lastUsedAt",
        DROP COLUMN IF EXISTS "revokedAt"
    `);
  }
}
