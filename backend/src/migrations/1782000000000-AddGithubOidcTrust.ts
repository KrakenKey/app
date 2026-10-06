import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GitHub Actions OIDC: trust policies that let a repository's workflows
 * exchange a GitHub OIDC token for a short-lived API key, and a `source`
 * column marking those keys.
 */
export class AddGithubOidcTrust1782000000000 implements MigrationInterface {
  name = 'AddGithubOidcTrust1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "github_oidc_trust" (
        "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
        "userId" TEXT NOT NULL,
        "name" VARCHAR(100) NOT NULL,
        "repository" VARCHAR(200) NOT NULL,
        "repositoryId" TEXT,
        "allowedRefs" TEXT[],
        "environment" VARCHAR(255),
        "scopes" TEXT[],
        "allowedDomainIds" UUID[],
        "allowedCertIds" INTEGER[],
        "lastUsedAt" TIMESTAMP,
        "lastUsedRef" TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_github_oidc_trust" PRIMARY KEY ("id"),
        CONSTRAINT "FK_github_oidc_trust_user" FOREIGN KEY ("userId")
          REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_github_oidc_trust_userId" ON "github_oidc_trust" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_github_oidc_trust_repository" ON "github_oidc_trust" (lower("repository"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_api_key" ADD COLUMN IF NOT EXISTS "source" TEXT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_api_key" DROP COLUMN IF EXISTS "source"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "github_oidc_trust"`);
  }
}
