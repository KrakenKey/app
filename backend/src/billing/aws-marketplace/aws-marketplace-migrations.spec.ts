import { AddAwsMarketplace1791800000000 } from '../../migrations/1791800000000-AddAwsMarketplace';

// Kept here, not next to the migrations: TypeORM loads every file in
// src/migrations as a migration.
function runner(awsRows: number) {
  const queries: string[] = [];
  return {
    queries,
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('count(*)')) return [{ n: awsRows }];
      return [];
    }),
  };
}

describe('AddAwsMarketplace migration', () => {
  it('only adds nullable columns, indexes and a new table', async () => {
    const qr = runner(0);
    await new AddAwsMarketplace1791800000000().up(qr as any);
    const sql = qr.queries.join('\n');
    expect(sql).toContain(`SET LOCAL lock_timeout = '5s'`);
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "awsCustomerAccountId" character varying',
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "awsAgreementId" character varying',
    );
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "aws_marketplace_registration"',
    );
    // Nothing the previous release relies on is changed or removed.
    const subscriptionChanges = qr.queries.filter((q) =>
      q.includes('ALTER TABLE "subscription"'),
    );
    for (const q of subscriptionChanges) {
      expect(q).not.toMatch(/NOT NULL|DROP|RENAME|ALTER COLUMN|DEFAULT/);
    }
  });

  it('refuses to revert while AWS-billed subscriptions exist', async () => {
    const qr = runner(3);
    await expect(
      new AddAwsMarketplace1791800000000().down(qr as any),
    ).rejects.toThrow(/3 subscription\(s\) have source 'aws_marketplace'/);
    expect(qr.queries.some((q) => q.includes('DROP'))).toBe(false);
  });

  it('drops what it added when there are none', async () => {
    const qr = runner(0);
    await new AddAwsMarketplace1791800000000().down(qr as any);
    const sql = qr.queries.join('\n');
    expect(sql).toContain(
      'DROP TABLE IF EXISTS "aws_marketplace_registration"',
    );
    expect(sql).toContain('DROP COLUMN IF EXISTS "awsAgreementId"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "awsCustomerAccountId"');
  });
});
