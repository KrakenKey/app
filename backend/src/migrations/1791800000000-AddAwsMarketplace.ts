import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AWS Marketplace SaaS contracts.
 *
 * An AWS-billed subscription reuses the Marketplace columns added for
 * Microsoft (`source` = 'aws_marketplace', `marketplaceSubscriptionId` =
 * license ARN, `marketplaceOfferId` = product code, `marketplacePlanId` =
 * contract dimension, `marketplaceStatus` = pending/active/ended) and adds
 * the buyer's AWS account id and the agreement id, which agreement events
 * are matched on.
 *
 * `aws_marketplace_registration` holds purchases resolved at the
 * fulfillment URL until the buyer links them to an account.
 *
 * Additive only (nullable columns, new indexes, a new table), so the
 * previous release keeps working beside this one: it never writes the new
 * columns or the new `source` value. lock_timeout keeps the ALTER from
 * queueing the previous release's writes behind a long wait.
 */
export class AddAwsMarketplace1791800000000 implements MigrationInterface {
  name = 'AddAwsMarketplace1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "subscription"
        ADD COLUMN IF NOT EXISTS "awsCustomerAccountId" character varying,
        ADD COLUMN IF NOT EXISTS "awsAgreementId" character varying
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscription_awsCustomerAccountId"
        ON "subscription" ("awsCustomerAccountId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscription_awsAgreementId"
        ON "subscription" ("awsAgreementId")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aws_marketplace_registration" (
        "id" character varying NOT NULL,
        "customerAwsAccountId" character varying NOT NULL,
        "licenseArn" character varying NOT NULL,
        "productCode" character varying NOT NULL,
        "agreementId" character varying,
        "offerType" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_aws_marketplace_registration" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_aws_marketplace_registration_expiresAt"
        ON "aws_marketplace_registration" ("expiresAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dropping the columns would leave AWS-billed rows the previous release
    // can't match to their agreements. Refuse while any exist.
    const rows = (await queryRunner.query(
      `SELECT count(*)::int AS n FROM "subscription" WHERE "source" = 'aws_marketplace'`,
    )) as { n: number }[];
    if ((rows[0]?.n ?? 0) > 0) {
      throw new Error(
        `Refusing to revert AddAwsMarketplace: ${rows[0].n} subscription(s) have source 'aws_marketplace'. Move or delete them first.`,
      );
    }
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "aws_marketplace_registration"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_awsAgreementId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_awsCustomerAccountId"`,
    );
    await queryRunner.query(`
      ALTER TABLE "subscription"
        DROP COLUMN IF EXISTS "awsAgreementId",
        DROP COLUMN IF EXISTS "awsCustomerAccountId"
    `);
  }
}
