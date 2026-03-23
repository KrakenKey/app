import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have a registry', () => {
    expect(service.registry).toBeDefined();
  });

  describe('counters and histograms', () => {
    it('should expose httpRequestsTotal counter', () => {
      expect(service.httpRequestsTotal).toBeDefined();
      service.httpRequestsTotal.inc({
        method: 'GET',
        route: '/test',
        status_code: 200,
      });
    });

    it('should expose httpRequestDuration histogram', () => {
      expect(service.httpRequestDuration).toBeDefined();
      const end = service.httpRequestDuration.startTimer({
        method: 'GET',
        route: '/test',
      });
      end();
    });

    it('should expose certIssuanceTotal counter', () => {
      expect(service.certIssuanceTotal).toBeDefined();
      service.certIssuanceTotal.inc({ status: 'success' });
    });

    it('should expose acmeChallengeDuration histogram', () => {
      expect(service.acmeChallengeDuration).toBeDefined();
    });

    it('should expose activeCertificatesTotal gauge', () => {
      expect(service.activeCertificatesTotal).toBeDefined();
      service.activeCertificatesTotal.set(10);
    });

    it('should expose certExpiryDays gauge', () => {
      expect(service.certExpiryDays).toBeDefined();
      service.certExpiryDays.set(25);
    });

    it('should expose domainsVerifiedTotal counter', () => {
      expect(service.domainsVerifiedTotal).toBeDefined();
      service.domainsVerifiedTotal.inc({ status: 'success' });
    });

    it('should expose authTotal counter', () => {
      expect(service.authTotal).toBeDefined();
      service.authTotal.inc({ method: 'jwt', status: 'success' });
    });
  });

  describe('onModuleInit', () => {
    it('should collect default metrics', () => {
      service.onModuleInit();
      // Default metrics are registered - registry should have metrics
      expect(service.registry.getMetricsAsJSON()).toBeDefined();
    });
  });

  describe('getMetrics', () => {
    it('should return metrics as a string', async () => {
      service.onModuleInit();
      const output = await service.getMetrics();
      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);
    });
  });
});
