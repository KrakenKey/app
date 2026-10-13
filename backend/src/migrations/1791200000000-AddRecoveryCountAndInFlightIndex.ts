import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `recoveryCount` caps how often a request that keeps losing its job (for
 * example a worker crashing on it) is recovered and re-queued. The partial
 * index serves the once-a-minute lookup of requests in flight.
 *
 * Additive only, so the previous release keeps working beside this one.
 * The index is small (only rows in flight) and built without CONCURRENTLY
 * inside the migration transaction; lock_timeout keeps it from queueing
 * the previous release's writes behind a long wait.
 */
export class AddRecoveryCountAndInFlightIndex1791200000000 implements MigrationInterface {
  name = 'AddRecoveryCountAndInFlightIndex1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ADD COLUMN IF NOT EXISTS "recoveryCount" INTEGER NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tls_crt_inFlight"
        ON "tls_crt" ("inFlightSince")
        WHERE "status" IN ('pending', 'issuing', 'renewing')
          AND "renewalQueuedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tls_crt_inFlight"`);
    await queryRunner.query(`
      ALTER TABLE "tls_crt" DROP COLUMN IF EXISTS "recoveryCount"
    `);
  }
}
