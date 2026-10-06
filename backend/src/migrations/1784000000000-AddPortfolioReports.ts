import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Portfolio TLS reports (#123): one row per report and one per scanned host.
 * Hosts are written as each scan finishes, so a running report can be read
 * part way through. Both tables cascade from the owning user.
 */
export class AddPortfolioReports1784000000000 implements MigrationInterface {
  name = 'AddPortfolioReports1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "report" (
        "id"             uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "userId"         text        NOT NULL,
        "name"           varchar(100),
        "status"         varchar(16) NOT NULL DEFAULT 'pending',
        "hostCount"      integer     NOT NULL,
        "shareTokenHash" varchar(64),
        "shareCreatedAt" TIMESTAMP,
        "shareExpiresAt" TIMESTAMP,
        "createdAt"      TIMESTAMP   NOT NULL DEFAULT now(),
        "startedAt"      TIMESTAMP,
        "completedAt"    TIMESTAMP,
        "expiresAt"      TIMESTAMP   NOT NULL,
        CONSTRAINT "PK_report" PRIMARY KEY ("id"),
        CONSTRAINT "FK_report_userId" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_report_userId_createdAt"
        ON "report" ("userId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_report_shareTokenHash"
        ON "report" ("shareTokenHash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_report_expiresAt"
        ON "report" ("expiresAt")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "report_host" (
        "id"        uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "reportId"  uuid        NOT NULL,
        "position"  integer     NOT NULL,
        "host"      varchar(253) NOT NULL,
        "port"      integer     NOT NULL DEFAULT 443,
        "status"    varchar(16) NOT NULL DEFAULT 'pending',
        "severity"  varchar(16),
        "result"    jsonb,
        "scannedAt" TIMESTAMP,
        CONSTRAINT "PK_report_host" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_report_host_reportId_host_port"
          UNIQUE ("reportId", "host", "port"),
        CONSTRAINT "FK_report_host_reportId" FOREIGN KEY ("reportId")
          REFERENCES "report"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_report_host_reportId_severity"
        ON "report_host" ("reportId", "severity")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "report_host"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "report"`);
  }
}
