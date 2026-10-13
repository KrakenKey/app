import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScanResultCleanupService } from './scan-result-cleanup.service';
import { ProbeScanResult } from '../entities/probe-scan-result.entity';

describe('ScanResultCleanupService', () => {
  let service: ScanResultCleanupService;
  let mockExecute: jest.Mock;
  let mockWhere: jest.Mock;

  beforeEach(async () => {
    mockExecute = jest.fn().mockResolvedValue({ affected: 0 });
    mockWhere = jest.fn().mockReturnValue({ execute: mockExecute });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanResultCleanupService,
        {
          provide: getRepositoryToken(ProbeScanResult),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue({
              delete: jest.fn().mockReturnValue({
                where: mockWhere,
              }),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ScanResultCleanupService>(ScanResultCleanupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should execute cleanup without errors', async () => {
    await expect(service.cleanupExpiredResults()).resolves.not.toThrow();
  });

  it('should batch delete when results exceed batch size', async () => {
    mockExecute
      .mockResolvedValueOnce({ affected: 10_000 }) // first batch full
      .mockResolvedValueOnce({ affected: 500 }) // second batch partial
      .mockResolvedValue({ affected: 0 }); // remaining calls

    await service.cleanupExpiredResults();

    // At least 2 calls for orphaned cleanup + calls for tier cleanup
    expect(mockExecute.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps plan retention for past_due subscriptions in the grace period', async () => {
    const before = Date.now();
    await service.cleanupExpiredResults();

    const tierCall = mockWhere.mock.calls.find(
      ([, params]) => params?.tier === 'starter',
    );
    expect(tierCall).toBeDefined();
    const [sql, params] = tierCall!;
    expect(sql).toContain(
      `s_personal.source <> 'marketplace' AND s_personal."pastDueSince" > :graceCutoff`,
    );
    expect(sql).toContain(
      `s_org.source <> 'marketplace' AND s_org."pastDueSince" > :graceCutoff`,
    );
    expect(sql).toContain(
      `s_org.source = 'marketplace' AND s_org."pastDueSince" > :marketplaceGraceCutoff`,
    );
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    expect(params.graceCutoff.getTime()).toBeGreaterThanOrEqual(
      before - fourteenDays,
    );
    expect(params.graceCutoff.getTime()).toBeLessThanOrEqual(
      Date.now() - fourteenDays,
    );
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(params.marketplaceGraceCutoff.getTime()).toBeGreaterThanOrEqual(
      before - thirtyDays,
    );
    expect(params.marketplaceGraceCutoff.getTime()).toBeLessThanOrEqual(
      Date.now() - thirtyDays,
    );
  });
});
