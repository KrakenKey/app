import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Probe reports look up the last result each probe sent for each endpoint
 * by when the API received it (`createdAt`), not by the probe's own
 * timestamp, to enforce the plan's scan interval. This index serves that
 * lookup (one DISTINCT ON query per report and per probe config).
 *
 * Additive only. CREATE INDEX blocks writes to probe_scan_result while it
 * builds, which is brief at the table's current size (results are kept
 * 7 to 90 days); lock_timeout keeps it from queueing behind a long lock.
 */
export class AddScanResultReceivedIndex1791650000000 implements MigrationInterface {
  name = 'AddScanResultReceivedIndex1791650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_probe_scan_result_endpointId_probeId_createdAt"
        ON "probe_scan_result" ("endpointId", "probeId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_probe_scan_result_endpointId_probeId_createdAt"`,
    );
  }
}
