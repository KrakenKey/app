import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Connectors: customer-hosted agents that enroll with a single-use token,
 * authenticate with an Ed25519 key, and report where they installed each
 * certificate.
 *
 * - `connector`: one row per connector, with the hashed enrollment token
 *   (cleared when used or replaced) and the public key set at enrollment.
 * - `connector_deployment`: the latest reported state of each
 *   (connector, certificate, target label).
 * - `user_api_key.connectorId`: the connector a short-lived key was issued
 *   to, so revoking the connector revokes its keys.
 */
export class AddConnectors1786000000000 implements MigrationInterface {
  name = 'AddConnectors1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "connector" (
        "id"                      UUID         NOT NULL DEFAULT uuid_generate_v4(),
        "userId"                  TEXT         NOT NULL,
        "name"                    VARCHAR(64)  NOT NULL,
        "clientLabel"             VARCHAR(64),
        "scopes"                  TEXT[]       NOT NULL,
        "allowedCertIds"          INTEGER[],
        "allowedDomainIds"        UUID[],
        "publicKey"               TEXT,
        "enrollmentTokenHash"      TEXT,
        "enrollmentTokenExpiresAt" TIMESTAMP,
        "enrolledAt"              TIMESTAMP,
        "revokedAt"               TIMESTAMP,
        "lastSeenAt"              TIMESTAMP,
        "staleAlertedAt"          TIMESTAMP,
        "version"                 VARCHAR(64),
        "os"                      VARCHAR(32),
        "arch"                    VARCHAR(32),
        "createdAt"               TIMESTAMP    NOT NULL DEFAULT now(),
        CONSTRAINT "PK_connector" PRIMARY KEY ("id"),
        CONSTRAINT "FK_connector_user" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_connector_userId" ON "connector" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_connector_enrollmentTokenHash" ON "connector" ("enrollmentTokenHash") WHERE "enrollmentTokenHash" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "connector_deployment" (
        "connectorId"   UUID         NOT NULL,
        "certificateId" INTEGER      NOT NULL,
        "label"         VARCHAR(64)  NOT NULL,
        "state"         VARCHAR(32)  NOT NULL,
        "serial"        VARCHAR(64),
        "error"         VARCHAR(200),
        "updatedAt"     TIMESTAMP    NOT NULL,
        "reportedAt"    TIMESTAMP    NOT NULL,
        CONSTRAINT "PK_connector_deployment"
          PRIMARY KEY ("connectorId", "certificateId", "label"),
        CONSTRAINT "FK_connector_deployment_connector" FOREIGN KEY ("connectorId")
          REFERENCES "connector"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_connector_deployment_certificate" FOREIGN KEY ("certificateId")
          REFERENCES "tls_crt"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_connector_deployment_certificateId" ON "connector_deployment" ("certificateId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "user_api_key" ADD COLUMN IF NOT EXISTS "connectorId" UUID`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "user_api_key" ADD CONSTRAINT "FK_user_api_key_connector"
          FOREIGN KEY ("connectorId") REFERENCES "connector"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_api_key_connectorId" ON "user_api_key" ("connectorId") WHERE "connectorId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_api_key_connectorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_api_key" DROP CONSTRAINT IF EXISTS "FK_user_api_key_connector"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_api_key" DROP COLUMN IF EXISTS "connectorId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "connector_deployment"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "connector"`);
  }
}
