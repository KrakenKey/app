import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEndpointsAndProbeEnhancements1775000000000 implements MigrationInterface {
  name = 'AddEndpointsAndProbeEnhancements1775000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── endpoint ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "endpoint" (
        "id"        uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "userId"    text        NOT NULL,
        "host"      varchar     NOT NULL,
        "port"      integer     NOT NULL DEFAULT 443,
        "sni"       varchar,
        "label"     varchar,
        "isActive"  boolean     NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP   NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_endpoint" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_endpoint_userId_host_port" UNIQUE ("userId", "host", "port")
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_endpoint_userId'
        ) THEN
          ALTER TABLE "endpoint"
            ADD CONSTRAINT "FK_endpoint_userId"
            FOREIGN KEY ("userId") REFERENCES "user"("id")
            ON DELETE CASCADE;
        END IF;
      END $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_endpoint_userId_isActive"
        ON "endpoint" ("userId", "isActive")
    `);

    // ── endpoint_hosted_region ──────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "endpoint_hosted_region" (
        "id"          uuid      NOT NULL DEFAULT uuid_generate_v4(),
        "endpointId"  uuid      NOT NULL,
        "region"      varchar   NOT NULL,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_endpoint_hosted_region" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_endpoint_hosted_region_endpointId_region" UNIQUE ("endpointId", "region")
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_endpoint_hosted_region_endpointId'
        ) THEN
          ALTER TABLE "endpoint_hosted_region"
            ADD CONSTRAINT "FK_endpoint_hosted_region_endpointId"
            FOREIGN KEY ("endpointId") REFERENCES "endpoint"("id")
            ON DELETE CASCADE;
        END IF;
      END $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_endpoint_hosted_region_region"
        ON "endpoint_hosted_region" ("region")
    `);

    // ── probe: add userId column ────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "probe"
        ADD COLUMN IF NOT EXISTS "userId" text
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_probe_userId'
        ) THEN
          ALTER TABLE "probe"
            ADD CONSTRAINT "FK_probe_userId"
            FOREIGN KEY ("userId") REFERENCES "user"("id")
            ON DELETE SET NULL;
        END IF;
      END $$
    `);

    // ── probe_scan_result: add endpointId, probeMode, probeRegion ──────
    await queryRunner.query(`
      ALTER TABLE "probe_scan_result"
        ADD COLUMN IF NOT EXISTS "endpointId" uuid,
        ADD COLUMN IF NOT EXISTS "probeMode" varchar,
        ADD COLUMN IF NOT EXISTS "probeRegion" varchar
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_probe_scan_result_endpointId'
        ) THEN
          ALTER TABLE "probe_scan_result"
            ADD CONSTRAINT "FK_probe_scan_result_endpointId"
            FOREIGN KEY ("endpointId") REFERENCES "endpoint"("id")
            ON DELETE SET NULL;
        END IF;
      END $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_probe_scan_result_endpointId_scannedAt"
        ON "probe_scan_result" ("endpointId", "scannedAt" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_probe_scan_result_userId_probeMode"
        ON "probe_scan_result" ("userId", "probeMode")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_probe_scan_result_endpointId_probeMode_probeRegion"
        ON "probe_scan_result" ("endpointId", "probeMode", "probeRegion")
    `);

    // ── Migrate old mode values ─────────────────────────────────────────
    await queryRunner.query(`
      UPDATE "probe" SET "mode" = 'standalone' WHERE "mode" = 'self-hosted'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert mode migration
    await queryRunner.query(`
      UPDATE "probe" SET "mode" = 'self-hosted' WHERE "mode" = 'standalone'
    `);

    // Drop new indexes on probe_scan_result
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_probe_scan_result_endpointId_probeMode_probeRegion"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_probe_scan_result_userId_probeMode"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_probe_scan_result_endpointId_scannedAt"`,
    );

    // Drop new columns on probe_scan_result
    await queryRunner.query(`
      ALTER TABLE "probe_scan_result"
        DROP CONSTRAINT IF EXISTS "FK_probe_scan_result_endpointId"
    `);
    await queryRunner.query(`
      ALTER TABLE "probe_scan_result"
        DROP COLUMN IF EXISTS "endpointId",
        DROP COLUMN IF EXISTS "probeMode",
        DROP COLUMN IF EXISTS "probeRegion"
    `);

    // Drop userId from probe
    await queryRunner.query(`
      ALTER TABLE "probe"
        DROP CONSTRAINT IF EXISTS "FK_probe_userId"
    `);
    await queryRunner.query(`
      ALTER TABLE "probe"
        DROP COLUMN IF EXISTS "userId"
    `);

    // Drop tables
    await queryRunner.query(
      `DROP TABLE IF EXISTS "endpoint_hosted_region" CASCADE`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "endpoint" CASCADE`);
  }
}
