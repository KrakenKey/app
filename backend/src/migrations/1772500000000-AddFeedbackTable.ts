import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFeedbackTable1772500000000 implements MigrationInterface {
  name = 'AddFeedbackTable1772500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "feedback" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "message" text NOT NULL, "rating" integer NOT NULL, "userId" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_feedback_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_feedback_userId') THEN ALTER TABLE "feedback" ADD CONSTRAINT "FK_feedback_userId" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION; END IF; END $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "feedback" DROP CONSTRAINT IF EXISTS "FK_feedback_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "feedback"`);
  }
}
