# Observability

The backend exposes Prometheus metrics on a single unauthenticated endpoint. This page documents the endpoint, the metric catalog, and the collection behavior that is not obvious from the metric names.

Implementation lives in `backend/src/metrics/`.

---

## The `/metrics` endpoint

```
GET /metrics
Content-Type: text/plain; version=0.0.4; charset=utf-8
```

`MetricsController` is annotated `@ApiExcludeController()`, so the endpoint does **not** appear in the OpenAPI document (`/swagger-json`) or the dev-only Swagger UI.

The endpoint has no authentication guard. It must not be exposed publicly: scrape it from inside the cluster or restrict it at the ingress. Some declared series carry customer-identifying labels (`endpoint_cert_expiry_days` is labelled by `host` and `port`, `probe_reports_total` by `probe_id`). Nothing populates them yet (see [Probes and endpoints](#probes-and-endpoints)), but once something does, an open `/metrics` would leak the customer endpoint inventory.

`/metrics` has no rate-limit category decorator, so the global `TierAwareThrottlerGuard` still runs on it and hits Redis before the controller. If Redis is unavailable, the scrape fails with a `500` regardless of the queue gauge's own timeouts below.

Node process and GC metrics are included: `MetricsService.onModuleInit()` calls `collectDefaultMetrics()` against the same registry, so the standard `process_*` and `nodejs_*` series are present alongside the application metrics below.

---

## Metric catalog

### HTTP

Recorded by `MetricsInterceptor`, registered globally as an `APP_INTERCEPTOR`. Requests that reach a controller are counted, including those whose handler throws, which are recorded with `err.status` (falling back to `500`).

Guards run before interceptors, so requests rejected by a guard are **not** counted. That covers `401` from `JwtOrApiKeyGuard`, `403` from `RoleGuard` and `429` from the throttler. Rate-limit rejections cannot be observed through `http_requests_total`. Unmatched paths are also not counted: Nest's not-found handler does not run interceptors.

| Metric | Type | Labels | Notes |
|--------|------|--------|-------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | `route` is the Express route pattern (`/certs/tls/:id`) |
| `http_request_duration_seconds` | Histogram | `method`, `route` | Buckets: 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5 |

The interceptor falls back to `req.url` when `req.route` is unset, but because unmatched requests never reach it, that fallback does not create per-path series in practice.

### Certificates

| Metric | Type | Labels | Notes |
|--------|------|--------|-------|
| `ari_checks_total` | Counter | `result` | ACME Renewal Information checks: `ok` (normal window stored), `none` (the CA has no info for the certificate), `error` (request failed, retried in 6 hours), `early_replacement` (the CA asked for early replacement) |
| `cert_issuance_total` | Counter | `status` | Final outcome per issuance or renewal job (`issued` or `failed`); retried attempts are not counted separately |
| `acme_challenge_duration_seconds` | Histogram | none | Full DNS-01 flow, **successful issuances only**. Buckets: 5, 15, 30, 60, 120, 300 seconds |
| `active_certificates_total` | Gauge | none | Certificates in `issued` status |
| `cert_expiry_nearest_days` | Gauge | none | Days until the nearest expiry among auto-renew certificates expiring within 30 days |

`acme_challenge_duration_seconds` starts its timer before the challenge-delegation precheck, but the observation is only recorded once the certificate has been downloaded. Any failure, including a precheck rejection for a missing `_acme-challenge` CNAME (see [Certificate Flow](./CERTIFICATE_FLOW.md#challenge-delegation-precheck)), records nothing.

Both gauges are set only by the daily 6 AM expiry check in `CertMonitorService`:

- They read `0` after every API restart until that job next runs. An alert such as `cert_expiry_nearest_days < 7` will fire after each deploy unless it ignores fresh pods.
- `cert_expiry_nearest_days` is only updated when at least one auto-renew certificate expires within 30 days. Otherwise it keeps its previous value. It does not cover certificates with auto-renew disabled.

### Domains and auth

| Metric | Type | Labels |
|--------|------|--------|
| `domains_verified_total` | Counter | `status` |
| `auth_total` | Counter | `method`, `status` |

### Probes and endpoints

| Metric | Type | Labels |
|--------|------|--------|
| `probe_reports_total` | Counter | `probe_id`, `mode` |
| `monitored_endpoints_total` | Gauge | `mode` |
| `endpoint_cert_expiry_days` | Gauge | `host`, `port`, `mode`, `region` |
| `hosted_probe_regions_active` | Gauge | none |
| `endpoint_latency_by_region_ms` | Histogram | `host`, `port`, `region` |

These are **declared in `MetricsService` but not populated**: nothing in `backend/src` writes to them. The labelled ones emit no series, and `hosted_probe_regions_active` always reads `0`. Do not build dashboards or alerts on them until they are wired up.

When they are, note that `endpoint_cert_expiry_days` and `endpoint_latency_by_region_ms` are labelled per monitored endpoint, so their cardinality will grow with the customer base, not with traffic.

### Alert channels

| Metric | Type | Labels | Notes |
|--------|------|--------|-------|
| `alert_deliveries_total` | Counter | `type`, `result` | One increment per delivery attempt to a Slack, Teams or webhook channel. `type`: `slack`, `teams`, `webhook`. `result`: `ok`, `retry` (failed, BullMQ will try again) or `failed` (no retry follows). The test-send button is not counted. |

### Queues

| Metric | Type | Labels | Notes |
|--------|------|--------|-------|
| `bullmq_queue_jobs` | Gauge | `queue`, `state` | Job counts per BullMQ queue |

Provided by `QueueMetricsService`. Queues covered: `tlsCertIssuance`, `orgDissolution` and `notifications`. States: `waiting`, `active`, `delayed`, `failed`, `completed`, `paused`.

Three behaviors matter when reading or changing this gauge:

- **Counts are read at scrape time, not polled.** The gauge supplies a `collect()` callback, so the Redis round-trip happens while Prometheus is scraping. Scrape interval therefore sets the sampling rate, and nothing queries Redis when nobody is scraping.
- **The gauge is `reset()` on every collection.** A queue whose counts could not be read contributes no series for that scrape rather than a stale one. Alerts on these series should tolerate gaps: use `max_over_time(...)` or an `absent()` companion rather than assuming continuity.
- **A slow job-count read degrades one queue, not the whole scrape.** Each `getJobCounts()` call is bounded by a 2-second timeout and wrapped individually; a failure logs a warning and omits that queue's series, and `/metrics` still returns every other metric with a `200`. This only covers slow or failing reads. If Redis is down entirely, the throttler fails the request first (see [above](#the-metrics-endpoint)).

Adding a queue means registering it in `metrics.module.ts` (`BullModule.registerQueue`) *and* injecting it into `QueueMetricsService`. Registering alone does not add it to the gauge.

---

## Scraping

The metrics endpoint is scraped by the Prometheus instance managed in the [`infra-int`](https://github.com/krakenkey/infra-int) repository, which is also where dashboards and alert rules live. This repository defines the metrics; it does not define what is alerted on.

A minimal scrape config:

```yaml
scrape_configs:
  - job_name: krakenkey-api
    metrics_path: /metrics
    static_configs:
      - targets: ['krakenkey-api:8080']
```

Because `bullmq_queue_jobs` reads Redis during the scrape, keep the Prometheus scrape timeout above the 2-second collection timeout. Otherwise a slow Redis turns into a failed scrape of every metric rather than a gap in one queue's series.

---

## Related

- [Configuration](./CONFIGURATION.md): `KK_BULLMQ_*` variables for the Redis connection the queue gauge reads
- [Certificate Flow](./CERTIFICATE_FLOW.md): what the `tlsCertIssuance` queue processes
- [Billing](./BILLING.md): what the `orgDissolution` queue processes
- [Rate Limiting](../../docs/RATE_LIMITING.md): the tier-aware throttler, which uses the same Redis instance under the `throttle:` prefix
