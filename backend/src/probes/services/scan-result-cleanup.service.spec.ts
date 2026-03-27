import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScanResultCleanupService } from './scan-result-cleanup.service';
import { ProbeScanResult } from '../entities/probe-scan-result.entity';

describe('ScanResultCleanupService', () => {
  let service: ScanResultCleanupService;
  let mockExecute: jest.Mock;

  beforeEach(async () => {
    mockExecute = jest.fn().mockResolvedValue({ affected: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanResultCleanupService,
        {
          provide: getRepositoryToken(ProbeScanResult),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue({
              delete: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  execute: mockExecute,
                }),
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
});
