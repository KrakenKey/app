import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  // --- HTTP ---
  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route'] as const,
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [this.registry],
  });

  // --- Certificates ---
  readonly certIssuanceTotal = new Counter({
    name: 'cert_issuance_total',
    help: 'Total number of certificate issuance attempts',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  readonly acmeChallengeDuration = new Histogram({
    name: 'acme_challenge_duration_seconds',
    help: 'Duration of ACME DNS-01 challenge flow',
    buckets: [5, 15, 30, 60, 120, 300],
    registers: [this.registry],
  });

  readonly activeCertificatesTotal = new Gauge({
    name: 'active_certificates_total',
    help: 'Number of currently issued certificates',
    registers: [this.registry],
  });

  readonly certExpiryDays = new Gauge({
    name: 'cert_expiry_nearest_days',
    help: 'Days until the nearest certificate expires',
    registers: [this.registry],
  });

  // --- Domains ---
  readonly domainsVerifiedTotal = new Counter({
    name: 'domains_verified_total',
    help: 'Total domain verification attempts',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  // --- Auth ---
  readonly authTotal = new Counter({
    name: 'auth_total',
    help: 'Total authentication attempts',
    labelNames: ['method', 'status'] as const,
    registers: [this.registry],
  });

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
