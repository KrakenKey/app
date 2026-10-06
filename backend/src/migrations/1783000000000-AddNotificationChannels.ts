import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationChannels1783000000000 implements MigrationInterface {
  name = 'AddNotificationChannels1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_channel" (
        "id"                 uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "userId"             text         NOT NULL,
        "type"               varchar(16)  NOT NULL,
        "name"               varchar(100) NOT NULL,
        "urlEncrypted"       text         NOT NULL,
        "secretEncrypted"    text,
        "events"             text[]       NOT NULL DEFAULT '{}',
        "enabled"            boolean      NOT NULL DEFAULT true,
        "lastDeliveryAt"     TIMESTAMP,
        "lastDeliveryStatus" varchar(16),
        "lastError"          text,
        "createdAt"          TIMESTAMP    NOT NULL DEFAULT now(),
        "updatedAt"          TIMESTAMP    NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_channel" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_notification_channel_type"
          CHECK ("type" IN ('slack', 'teams', 'webhook'))
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_notification_channel_userId'
        ) THEN
          ALTER TABLE "notification_channel"
            ADD CONSTRAINT "FK_notification_channel_userId"
            FOREIGN KEY ("userId") REFERENCES "user"("id")
            ON DELETE CASCADE;
        END IF;
      END $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notification_channel_userId"
        ON "notification_channel" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_notification_channel_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_channel"`);
  }
}
