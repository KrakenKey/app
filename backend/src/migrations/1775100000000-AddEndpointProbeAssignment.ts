import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEndpointProbeAssignment1775100000000 implements MigrationInterface {
  name = 'AddEndpointProbeAssignment1775100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "endpoint_probe_assignment" (
        "id"          uuid      NOT NULL DEFAULT uuid_generate_v4(),
        "endpointId"  uuid      NOT NULL,
        "probeId"     varchar   NOT NULL,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_endpoint_probe_assignment" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_endpoint_probe_assignment" UNIQUE ("endpointId", "probeId")
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_endpoint_probe_assignment_endpointId'
        ) THEN
          ALTER TABLE "endpoint_probe_assignment"
            ADD CONSTRAINT "FK_endpoint_probe_assignment_endpointId"
            FOREIGN KEY ("endpointId") REFERENCES "endpoint"("id")
            ON DELETE CASCADE;
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_endpoint_probe_assignment_probeId'
        ) THEN
          ALTER TABLE "endpoint_probe_assignment"
            ADD CONSTRAINT "FK_endpoint_probe_assignment_probeId"
            FOREIGN KEY ("probeId") REFERENCES "probe"("id")
            ON DELETE CASCADE;
        END IF;
      END $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_endpoint_probe_assignment_probeId"
        ON "endpoint_probe_assignment" ("probeId")
    `);

    // Also add lastScanRequestedAt if it doesn't exist yet
    await queryRunner.query(`
      ALTER TABLE "endpoint"
        ADD COLUMN IF NOT EXISTS "lastScanRequestedAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "endpoint_probe_assignment" CASCADE`,
    );
    await queryRunner.query(`
      ALTER TABLE "endpoint"
        DROP COLUMN IF EXISTS "lastScanRequestedAt"
    `);
  }
}
