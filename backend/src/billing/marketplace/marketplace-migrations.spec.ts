import { AddMarketplaceSubscriptions1790000000000 } from '../../migrations/1790000000000-AddMarketplaceSubscriptions';
import { AddMarketplaceOperationFollowUp1790100000000 } from '../../migrations/1790100000000-AddMarketplaceOperationFollowUp';

// Kept here, not next to the migrations: TypeORM loads every file in
// src/migrations as a migration.
function runner(marketplaceRows: number) {
  const queries: string[] = [];
  return {
    queries,
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('count(*)')) return [{ n: marketplaceRows }];
      return [];
    }),
  };
}

describe('Marketplace migrations', () => {
  describe('AddMarketplaceSubscriptions down', () => {
    it('refuses to drop the columns while Marketplace subscriptions exist', async () => {
      const qr = runner(2);
      await expect(
        new AddMarketplaceSubscriptions1790000000000().down(qr as any),
      ).rejects.toThrow(/2 subscription\(s\) have source 'marketplace'/);
      expect(qr.queries.some((q) => q.includes('DROP'))).toBe(false);
    });

    it('drops them when there are none', async () => {
      const qr = runner(0);
      await new AddMarketplaceSubscriptions1790000000000().down(qr as any);
      expect(
        qr.queries.some((q) =>
          q.includes('DROP TABLE IF EXISTS "marketplace_operation"'),
        ),
      ).toBe(true);
      expect(
        qr.queries.some((q) => q.includes('DROP COLUMN IF EXISTS "source"')),
      ).toBe(true);
    });
  });

  it('only adds nullable columns for the operation follow-up', async () => {
    const qr = runner(0);
    await new AddMarketplaceOperationFollowUp1790100000000().up(qr as any);
    const sql = qr.queries.join('\n');
    expect(sql).toContain('"ackStatus" character varying');
    expect(sql).toContain('"dissolveOrganizationId" uuid');
    expect(sql).not.toMatch(/NOT NULL/);
  });
});
