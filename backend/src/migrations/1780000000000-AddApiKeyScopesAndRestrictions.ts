import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scopes and restrictions for user API keys. Every column is nullable and
 * NULL means "unrestricted", so existing keys keep full access with no
 * backfill.
 */
export class AddApiKeyScopesAndRestrictions1780000000000 implements MigrationInterface {
  name = 'AddApiKeyScopesAndRestrictions1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_api_key"
        ADD COLUMN IF NOT EXISTS "scopes" TEXT[],
        ADD COLUMN IF NOT EXISTS "allowedDomainIds" UUID[],
        ADD COLUMN IF NOT EXISTS "allowedCertIds" INTEGER[],
        ADD COLUMN IF NOT EXISTS "allowedIps" TEXT[]
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_api_key"
        DROP COLUMN IF EXISTS "allowedIps",
        DROP COLUMN IF EXISTS "allowedCertIds",
        DROP COLUMN IF EXISTS "allowedDomainIds",
        DROP COLUMN IF EXISTS "scopes"
    `);
  }
}
