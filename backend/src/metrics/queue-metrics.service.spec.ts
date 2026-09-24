import { Queue } from 'bullmq';
import { MetricsService } from './metrics.service';
import { QueueMetricsService } from './queue-metrics.service';

function mockQueue(name: string, getJobCounts: jest.Mock): Queue {
  return { name, getJobCounts } as unknown as Queue;
}

describe('QueueMetricsService', () => {
  let metricsService: MetricsService;

  beforeEach(() => {
    metricsService = new MetricsService();
  });

  it('should expose job counts per queue and state on scrape', async () => {
    const tlsCounts = jest.fn().mockResolvedValue({
      waiting: 2,
      active: 1,
      delayed: 0,
      failed: 3,
      completed: 40,
      paused: 0,
    });
    const orgCounts = jest.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 1,
      failed: 0,
      completed: 5,
      paused: 0,
    });
    new QueueMetricsService(
      metricsService,
      mockQueue('tlsCertIssuance', tlsCounts),
      mockQueue('orgDissolution', orgCounts),
    );

    const output = await metricsService.getMetrics();

    expect(output).toContain(
      'bullmq_queue_jobs{queue="tlsCertIssuance",state="waiting"} 2',
    );
    expect(output).toContain(
      'bullmq_queue_jobs{queue="tlsCertIssuance",state="failed"} 3',
    );
    expect(output).toContain(
      'bullmq_queue_jobs{queue="orgDissolution",state="delayed"} 1',
    );
    expect(tlsCounts).toHaveBeenCalledWith(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
      'paused',
    );
  });

  it('should not read Redis until scraped', () => {
    const counts = jest.fn();
    new QueueMetricsService(
      metricsService,
      mockQueue('tlsCertIssuance', counts),
      mockQueue('orgDissolution', counts),
    );

    expect(counts).not.toHaveBeenCalled();
  });

  it('should omit a failing queue without failing the scrape', async () => {
    const ok = jest.fn().mockResolvedValue({ waiting: 1 });
    const broken = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    new QueueMetricsService(
      metricsService,
      mockQueue('tlsCertIssuance', broken),
      mockQueue('orgDissolution', ok),
    );

    const output = await metricsService.getMetrics();

    expect(output).not.toContain('queue="tlsCertIssuance"');
    expect(output).toContain(
      'bullmq_queue_jobs{queue="orgDissolution",state="waiting"} 1',
    );
    expect(output).toContain(
      'bullmq_queue_jobs{queue="orgDissolution",state="failed"} 0',
    );
  });

  it('should drop series from a previous scrape when a queue later fails', async () => {
    const counts = jest
      .fn()
      .mockResolvedValueOnce({ waiting: 7 })
      .mockRejectedValueOnce(new Error('timeout'));
    const ok = jest.fn().mockResolvedValue({});
    new QueueMetricsService(
      metricsService,
      mockQueue('tlsCertIssuance', counts),
      mockQueue('orgDissolution', ok),
    );

    expect(await metricsService.getMetrics()).toContain(
      'bullmq_queue_jobs{queue="tlsCertIssuance",state="waiting"} 7',
    );
    expect(await metricsService.getMetrics()).not.toContain(
      'queue="tlsCertIssuance"',
    );
  });
});
