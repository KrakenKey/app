# Public Scan API

The public scan API lets unauthenticated users scan a public TLS endpoint. KrakenKey proxies the request to the internal probe service, applying SSRF protection and rate limiting before forwarding.

This endpoint backs the free TLS scanner at [krakenkey.io/scanner](https://krakenkey.io/scanner).

## Endpoint

```
POST /public/scan
```

No authentication required.

## Request body

```json
{
  "hostname": "example.com",
  "port": 443
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `hostname` | `string` | Yes | Hostname to scan. Must be a publicly routable address. |
| `port` | `number` | No | TCP port (default `443`). |

## Response

Returns the probe's scan result. See `shared/src/types/public-scan.ts` for the `PublicScanResponse` type.

## Errors

| Status | Meaning |
|--------|---------|
| `400` | Invalid hostname or port |
| `422` | Hostname resolves to a private/reserved IP (SSRF blocked) |
| `429` | Rate limit exceeded |
| `502` | Probe unreachable or returned an error |

## Security

- **SSRF protection** — Private, loopback, link-local, and reserved IP ranges are rejected before the request is proxied.
- **Rate limiting** — Enforced per client IP via the NestJS throttler. Excessive requests return `429`.
- **No authentication** — Intentionally unauthenticated to support the public scanner page at [krakenkey.io/scanner](https://krakenkey.io/scanner).

## Configuration

Set the following variables on the API service:

| Variable | Description |
|----------|-------------|
| `KK_PROBE_INTERNAL_URL` | Internal base URL of the probe (e.g. `http://krakenkey-probe:8081`) |
| `KK_PROBE_SCAN_SECRET` | Bearer token forwarded to `POST /scan` on the probe — must equal `KK_PROBE_SCAN_API_SECRET` on the probe side |

Both variables are required when `PublicScanModule` is loaded. See [krakenkey/infra-int](https://github.com/KrakenKey/infra-int) for the Docker Compose network configuration that places the probe on an internal bridge reachable by this URL.

## Related

- [`docs/CHANGELOG.md`](CHANGELOG.md) — feature history
- [krakenkey/probe — On-Demand Scan API](https://github.com/KrakenKey/probe) — probe-side endpoint documentation
- [krakenkey/infra-int](https://github.com/KrakenKey/infra-int) — Docker Compose networking
