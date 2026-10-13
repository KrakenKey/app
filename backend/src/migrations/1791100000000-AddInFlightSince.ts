import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `inFlightSince`: when a certificate's current issuance or renewal was
 * handed to the worker. Jobs carry it as a fencing token, and the renewal
 * queue sweep uses it to recover requests whose job was lost (stalled past
 * BullMQ's limit, Redis flushed, a crash between saving and queuing).
 * Existing in-flight rows start with NULL and are timed from the first
 * sweep that sees them.
 *
 * Additive only, so the previous release keeps working beside this one.
 */
export class AddInFlightSince1791100000000 implements MigrationInterface {
  name = 'AddInFlightSince1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "tls_crt"
        ADD COLUMN IF NOT EXISTS "inFlightSince" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tls_crt" DROP COLUMN IF EXISTS "inFlightSince"
    `);
  }
}
