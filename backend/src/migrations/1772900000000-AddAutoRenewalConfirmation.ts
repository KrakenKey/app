import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutoRenewalConfirmation1772900000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
        ADD COLUMN IF NOT EXISTS "autoRenewalConfirmedAt" TIMESTAMP DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS "autoRenewalReminderSentAt" TIMESTAMP DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
        DROP COLUMN IF EXISTS "autoRenewalConfirmedAt",
        DROP COLUMN IF EXISTS "autoRenewalReminderSentAt"
    `);
  }
}
