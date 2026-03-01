import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1771260925669 implements MigrationInterface {
  name = 'InitialSchema1771260925669';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "user" ("id" text NOT NULL, "username" character varying NOT NULL, "email" character varying NOT NULL, "groups" text array NOT NULL DEFAULT '{}', CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "user_api_key" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "hash" character varying NOT NULL, "expiresAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" text NOT NULL, CONSTRAINT "PK_9180f9a158e8cda6864358cd462" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "domain" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "hostname" character varying NOT NULL, "verificationCode" character varying NOT NULL, "isVerified" boolean NOT NULL DEFAULT false, "userId" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_27e3ec3ea0ae02c8c5bceab3ba9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "tls_crt" ("id" SERIAL NOT NULL, "rawCsr" character varying NOT NULL, "parsedCsr" jsonb NOT NULL, "crtPem" text, "status" text DEFAULT 'pending', "expiresAt" TIMESTAMP, "lastRenewedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" text, CONSTRAINT "PK_c6192633c5a1c7634a8037d9c4a" PRIMARY KEY ("id"))`,
    );

    // Foreign keys — skip if they already exist (for existing databases created by synchronize)
    await queryRunner.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_c6316cc59f67b45ed31310bce53') THEN ALTER TABLE "user_api_key" ADD CONSTRAINT "FK_c6316cc59f67b45ed31310bce53" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION; END IF; END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_dde349027ada546b854e9fdb5fc') THEN ALTER TABLE "domain" ADD CONSTRAINT "FK_dde349027ada546b854e9fdb5fc" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; END IF; END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_a57ae79c1c1714dcb2f531d0412') THEN ALTER TABLE "tls_crt" ADD CONSTRAINT "FK_a57ae79c1c1714dcb2f531d0412" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; END IF; END $$`,
    );

    // Fix column type drift: synchronize created status as varchar, entity defines it as text
    await queryRunner.query(
      `ALTER TABLE "tls_crt" ALTER COLUMN "status" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tls_crt" DROP CONSTRAINT IF EXISTS "FK_a57ae79c1c1714dcb2f531d0412"`,
    );
    await queryRunner.query(
      `ALTER TABLE "domain" DROP CONSTRAINT IF EXISTS "FK_dde349027ada546b854e9fdb5fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_api_key" DROP CONSTRAINT IF EXISTS "FK_c6316cc59f67b45ed31310bce53"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "tls_crt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "domain"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_api_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user"`);
  }
}
