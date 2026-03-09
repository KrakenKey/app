import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionTable1772800000000 implements MigrationInterface {
  name = 'AddSubscriptionTable1772800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "subscription" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" text NOT NULL,
        "stripeCustomerId" character varying NOT NULL,
        "stripeSubscriptionId" character varying,
        "plan" character varying NOT NULL DEFAULT 'free',
        "status" character varying NOT NULL DEFAULT 'active',
        "currentPeriodEnd" TIMESTAMP,
        "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_subscription_userId" UNIQUE ("userId")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_subscription_userId" ON "subscription" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_subscription_stripeCustomerId" ON "subscription" ("stripeCustomerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_subscription_stripeSubscriptionId" ON "subscription" ("stripeSubscriptionId")`,
    );
    await queryRunner.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_subscription_userId') THEN ALTER TABLE "subscription" ADD CONSTRAINT "FK_subscription_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION; END IF; END $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscription" DROP CONSTRAINT IF EXISTS "FK_subscription_userId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_stripeSubscriptionId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_stripeCustomerId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription"`);
  }
}
