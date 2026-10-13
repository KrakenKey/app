import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a handled Marketplace webhook still owed when it was recorded: the
 * answer Microsoft waits for (`ackStatus`) and the organization dissolution
 * it triggered. A redelivered webhook re-sends the answer while Microsoft
 * still shows the operation InProgress, and re-queues the dissolution, in
 * case the first delivery failed after recording the operation.
 *
 * Nullable columns only, so the previous release keeps working.
 */
export class AddMarketplaceOperationFollowUp1790100000000 implements MigrationInterface {
  name = 'AddMarketplaceOperationFollowUp1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_operation"
        ADD COLUMN IF NOT EXISTS "ackStatus" character varying,
        ADD COLUMN IF NOT EXISTS "dissolveOrganizationId" uuid,
        ADD COLUMN IF NOT EXISTS "dissolveCancel" boolean
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_operation"
        DROP COLUMN IF EXISTS "dissolveCancel",
        DROP COLUMN IF EXISTS "dissolveOrganizationId",
        DROP COLUMN IF EXISTS "ackStatus"
    `);
  }
}
