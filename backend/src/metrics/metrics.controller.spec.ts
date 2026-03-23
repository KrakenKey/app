import { Test, TestingModule } from '@nestjs/testing';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  let controller: MetricsController;
  let mockMetricsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockMetricsService = {
      getMetrics: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [{ provide: MetricsService, useValue: mockMetricsService }],
    }).compile();

    controller = module.get<MetricsController>(MetricsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMetrics', () => {
    it('should return metrics string from service', async () => {
      const metricsOutput =
        '# HELP http_requests_total\nhttp_requests_total 42';
      mockMetricsService.getMetrics.mockResolvedValue(metricsOutput);

      const result = await controller.getMetrics();

      expect(result).toBe(metricsOutput);
      expect(mockMetricsService.getMetrics).toHaveBeenCalled();
    });
  });
});
