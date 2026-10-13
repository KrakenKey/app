import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renewal queue: a renewal past the plan's concurrent pending limit now
 * waits instead of being refused. `renewalQueuedAt` is set while it waits
 * (status stays 'renewing') and cleared when it starts. The partial index
 * keeps the once-a-minute lookup of waiting renewals cheap.
 *
 * Additive only, so the previous release keeps working beside this one
 * during a deploy: it ignores the column.
 */
export class AddRenewalQueue1791000000000 implements MigrationInterface {
  name = 'AddRenewalQueue1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The previous release keeps serving during a deploy: give up rather
    // than queue its requests behind a long wait for the table lock
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ADD COLUMN IF NOT EXISTS "renewalQueuedAt" TIMESTAMP
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tls_crt_renewalQueuedAt"
        ON "tls_crt" ("renewalQueuedAt")
        WHERE "renewalQueuedAt" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Renewals still waiting would be stranded in 'renewing' without the
    // column; put them back to 'issued' so auto-renewal picks them up again.
    await queryRunner.query(`
      UPDATE "tls_crt" SET "status" = 'issued'
        WHERE "renewalQueuedAt" IS NOT NULL AND "status" = 'renewing'
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tls_crt_renewalQueuedAt"`,
    );
    await queryRunner.query(`
      ALTER TABLE "tls_crt" DROP COLUMN IF EXISTS "renewalQueuedAt"
    `);
  }
}
