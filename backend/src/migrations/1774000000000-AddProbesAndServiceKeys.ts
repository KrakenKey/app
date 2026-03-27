import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProbesAndServiceKeys1774000000000 implements MigrationInterface {
  name = 'AddProbesAndServiceKeys1774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── service_api_key ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "service_api_key" (
        "id"          uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "name"        varchar     NOT NULL,
        "hash"        varchar     NOT NULL,
        "expiresAt"   TIMESTAMP,
        "revokedAt"   TIMESTAMP,
        "createdAt"   TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_service_api_key" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_service_api_key_hash" UNIQUE ("hash")
      )
    `);

    // ── probe ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "probe" (
        "id"          varchar     NOT NULL,
        "name"        varchar     NOT NULL,
        "version"     varchar     NOT NULL,
        "mode"        varchar     NOT NULL,
        "region"      varchar,
        "os"          varchar     NOT NULL,
        "arch"        varchar     NOT NULL,
        "status"      varchar     NOT NULL DEFAULT 'active',
        "lastSeenAt"  TIMESTAMP,
        "createdAt"   TIMESTAMP   NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_probe" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_probe_status"
        ON "probe" ("status")
    `);

    // ── probe_scan_result ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "probe_scan_result" (
        "id"                      uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "probeId"                 varchar     NOT NULL,
        "host"                    varchar     NOT NULL,
        "port"                    integer     NOT NULL,
        "sni"                     varchar,
        "userId"                  text,
        "connectionSuccess"       boolean     NOT NULL,
        "connectionError"         text,
        "latencyMs"               integer,
        "tlsVersion"              varchar,
        "cipherSuite"             varchar,
        "ocspStapled"             boolean,
        "certSubject"             varchar,
        "certSans"                text[],
        "certIssuer"              varchar,
        "certSerialNumber"        varchar,
        "certNotBefore"           TIMESTAMP,
        "certNotAfter"            TIMESTAMP,
        "certDaysUntilExpiry"     integer,
        "certKeyType"             varchar,
        "certKeySize"             integer,
        "certSignatureAlgorithm"  varchar,
        "certFingerprint"         varchar,
        "certChainDepth"          integer,
        "certChainComplete"       boolean,
        "certTrusted"             boolean,
        "scannedAt"               TIMESTAMP   NOT NULL,
        "createdAt"               TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_probe_scan_result" PRIMARY KEY ("id")
      )
    `);

    // Foreign key: probe_scan_result.probeId → probe.id
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_probe_scan_result_probeId'
        ) THEN
          ALTER TABLE "probe_scan_result"
            ADD CONSTRAINT "FK_probe_scan_result_probeId"
            FOREIGN KEY ("probeId") REFERENCES "probe"("id")
            ON DELETE CASCADE;
        END IF;
      END $$
    `);

    // Indexes for common query patterns
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_probe_scan_result_probeId_scannedAt"
        ON "probe_scan_result" ("probeId", "scannedAt" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_probe_scan_result_userId_scannedAt"
        ON "probe_scan_result" ("userId", "scannedAt" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_probe_scan_result_host_port_scannedAt"
        ON "probe_scan_result" ("host", "port", "scannedAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "probe_scan_result" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "probe" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_api_key" CASCADE`);
  }
}
