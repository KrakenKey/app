import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProbeMonitorService } from './probe-monitor.service';
import { Probe } from '../entities/probe.entity';

describe('ProbeMonitorService', () => {
  let service: ProbeMonitorService;
  let probeRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    probeRepo = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProbeMonitorService,
        { provide: getRepositoryToken(Probe), useValue: probeRepo },
      ],
    }).compile();

    service = module.get<ProbeMonitorService>(ProbeMonitorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should update stale probes', async () => {
    probeRepo.update.mockResolvedValue({ affected: 3 });

    await service.checkStaleProbes();

    expect(probeRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
      { status: 'stale' },
    );
  });

  it('should handle no stale probes gracefully', async () => {
    probeRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.checkStaleProbes()).resolves.not.toThrow();
  });
});
