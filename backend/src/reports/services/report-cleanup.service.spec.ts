import { ReportCleanupService } from './report-cleanup.service';

describe('ReportCleanupService', () => {
  it('purges expired reports and share links', async () => {
    const reports = {
      purgeExpired: jest.fn().mockResolvedValue({ reports: 2, shares: 1 }),
    };
    await new ReportCleanupService(reports as never).purge();
    expect(reports.purgeExpired).toHaveBeenCalledTimes(1);
  });
});
