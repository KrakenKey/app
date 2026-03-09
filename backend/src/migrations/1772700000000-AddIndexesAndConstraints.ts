import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexesAndConstraints1772700000000
  implements MigrationInterface
{
  name = 'AddIndexesAndConstraints1772700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── domain ──────────────────────────────────────────────────
    // Unique constraint: one hostname per user
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_domain_userId_hostname" ON "domain" ("userId", "hostname")`,
    );
    // Covers findAll(userId), findAllVerified(userId, isVerified), count(userId)
    await queryRunner.query(
      `CREATE INDEX "IDX_domain_userId_isVerified" ON "domain" ("userId", "isVerified")`,
    );
    // Covers domain monitor daily scan for all verified domains
    await queryRunner.query(
      `CREATE INDEX "IDX_domain_isVerified" ON "domain" ("isVerified") WHERE "isVerified" = true`,
    );

    // ── tls_crt ─────────────────────────────────────────────────
    // Covers findAll(userId), count(userId)
    await queryRunner.query(
      `CREATE INDEX "IDX_tls_crt_userId" ON "tls_crt" ("userId")`,
    );
    // Covers cert monitor: find issued certs with autoRenew expiring soon
    await queryRunner.query(
      `CREATE INDEX "IDX_tls_crt_status_autoRenew_expiresAt" ON "tls_crt" ("status", "autoRenew", "expiresAt")`,
    );

    // ── user_api_key ────────────────────────────────────────────
    // Covers listApiKeys(userId), deleteApiKey(id, userId)
    await queryRunner.query(
      `CREATE INDEX "IDX_user_api_key_userId" ON "user_api_key" ("userId")`,
    );
    // Unique hash — auth hot path (validateApiKey)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_api_key_hash" ON "user_api_key" ("hash")`,
    );

    // ── user ────────────────────────────────────────────────────
    // Unique email for findByEmail lookups
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_email" ON "user" ("email")`,
    );

    // ── feedback ────────────────────────────────────────────────
    // FK index
    await queryRunner.query(
      `CREATE INDEX "IDX_feedback_userId" ON "feedback" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_feedback_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_user_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_user_api_key_hash"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_api_key_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tls_crt_status_autoRenew_expiresAt"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tls_crt_userId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_domain_isVerified"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_domain_userId_isVerified"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_domain_userId_hostname"`,
    );
  }
}
