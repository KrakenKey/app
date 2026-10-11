import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Connector config summary: a read-only summary of what each connector is
 * configured to do (certificates, key store, targets, plugin versions),
 * sent by the connector with PUT /connectors/config and shown on the
 * connector's page. All three columns are null until the connector shares
 * a summary, and again after it turns sharing off.
 */
export class AddConnectorConfigSummary1788000000000 implements MigrationInterface {
  name = 'AddConnectorConfigSummary1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "connector"
        ADD COLUMN IF NOT EXISTS "configSummary" JSONB,
        ADD COLUMN IF NOT EXISTS "configHash" VARCHAR(64),
        ADD COLUMN IF NOT EXISTS "configReportedAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "connector"
        DROP COLUMN IF EXISTS "configSummary",
        DROP COLUMN IF EXISTS "configHash",
        DROP COLUMN IF EXISTS "configReportedAt"
    `);
  }
}
