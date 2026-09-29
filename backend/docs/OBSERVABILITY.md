# Observability

The backend exposes Prometheus metrics on a single unauthenticated endpoint. This page documents the endpoint, the metric catalogue, and the collection behaviour that is not obvious from the metric names.

Implementation lives in `backend/src/metrics/`.

---

## The `/metrics` endpoint

```
GET /metrics
Content-Type: text/plain; version=0.0.4; charset=utf-8
```

`MetricsController` is annotated `@ApiExcludeController()`, so the endpoint does **not** appear in the Swagger document at `/swagger`.

The endpoint has no authentication guard. It must not be exposed publicly — scrape it from inside the cluster or restrict it at the ingress. Several series carry customer-identifying labels (`endpoint_cert_expiry_days` is labelled by `host` and `port`, `probe_reports_total` by `probe_id`), so an open `/metrics` leaks the customer endpoint inventory.

Node process and GC metrics are included: `MetricsService.onModuleInit()` calls `collectDefaultMetrics()` against the same registry, so the standard `process_*` and `nodejs_*` series are present alongside the application metrics below.

---

## Metric catalogue

### HTTP

Recorded by `MetricsInterceptor`, registered globally as an `APP_INTERCEPTOR`, so every routed request is counted — including requests that end in an error, which are counted with `err.status` (falling back to `500`).

| Metric | Type | Labels | Notes |
|--------|------|--------|-------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | `route` is the Express route pattern (`/certs/tls/:id`), falling back to the raw URL when no route matched |
| `http_request_duration_seconds` | Histogram | `method`, `route` | Buckets: 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5 |

Because `route` falls back to `req.url` for unmatched requests, a scanner hitting random paths produces one series per path. Watch series cardinality if the API is exposed to unauthenticated traffic.

### Certificates

| Metric | Type | Labels | Notes |
|--------|------|--------|-------|
| `cert_issuance_total` | Counter | `status` | Issuance attempts |
| `acme_challenge_duration_seconds` | Histogram | — | Full DNS-01 flow. Buckets: 5, 15, 30, 60, 120, 300 seconds |
| `active_certificates_total` | Gauge | — | Currently issued certificates |
| `cert_expiry_nearest_days` | Gauge | — | Days until the *nearest* certificate expiry across the fleet |

`acme_challenge_duration_seconds` starts before the challenge-delegation precheck (see [Certificate Flow](./CERTIFICATE_FLOW.md)), so a certificate rejected for a missing `_acme-challenge` CNAME records a short observation rather than none at all.

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
| `hosted_probe_regions_active` | Gauge | — |
| `endpoint_latency_by_region_ms` | Histogram | `host`, `port`, `region` |

`endpoint_cert_expiry_days` and `endpoint_latency_by_region_ms` are labelled per monitored endpoint. Their cardinality grows with the customer base, not with traffic.

### Queues

| Metric | Type | Labels | Notes |
|--------|------|--------|-------|
| `bullmq_queue_jobs` | Gauge | `queue`, `state` | Job counts per BullMQ queue |

Provided by `QueueMetricsService`. Queues covered: `tlsCertIssuance` and `orgDissolution`. States: `waiting`, `active`, `delayed`, `failed`, `completed`, `paused`.

Three behaviours matter when reading or changing this gauge:

- **Counts are read at scrape time, not polled.** The gauge supplies a `collect()` callback, so the Redis round-trip happens while Prometheus is scraping. Scrape interval therefore sets the sampling rate, and nothing queries Redis when nobody is scraping.
- **The gauge is `reset()` on every collection.** A queue whose counts could not be read contributes no series for that scrape rather than a stale one. Alerts on these series should tolerate gaps — use `max_over_time(...)` or an `absent()` companion rather than assuming continuity.
- **A slow Redis degrades one queue, not the whole scrape.** Each `getJobCounts()` call is bounded by a 2-second timeout and wrapped individually; a failure logs a warning and omits that queue's series. `/metrics` still returns every other metric with a `200`.

Adding a queue means registering it in `metrics.module.ts` (`BullModule.registerQueue`) *and* injecting it into `QueueMetricsService` — registering alone does not add it to the gauge.

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

Because `bullmq_queue_jobs` reads Redis during the scrape, keep the Prometheus scrape timeout above the 2-second collection timeout — otherwise a slow Redis turns into a failed scrape of every metric rather than a gap in one queue's series.

---

## Related

- [Configuration](./CONFIGURATION.md) — `KK_BULLMQ_*` variables for the Redis connection the queue gauge reads
- [Certificate Flow](./CERTIFICATE_FLOW.md) — what the `tlsCertIssuance` queue processes
- [Billing](./BILLING.md) — what the `orgDissolution` queue processes
- [Rate Limiting](../../docs/RATE_LIMITING.md) — the tier-aware throttler, which uses the same Redis instance under the `throttle:` prefix
