# Public Scan API

The Public Scan API exposes a single unauthenticated endpoint that proxies TLS scan requests to a hosted probe. It is designed for the [/scanner](https://krakenkey.com/scanner) page and third-party integrations that need on-demand TLS inspection without a KrakenKey account.

---

## Endpoint

```
POST /public/scan
```

**Authentication**: None required.

**Rate limiting**: Per-IP, enforced at the API gateway layer. Repeated bursts from the same IP will receive `429 Too Many Requests`.

**SSRF protection**: The API validates that the target hostname resolves to a public, routable IP address before forwarding the request to the probe. Private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, link-local, loopback) are rejected with `400 Bad Request`.

---

## Request

### Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |

### Body

```json
{
  "host": "example.com",
  "port": 443
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `host` | string | Yes | Hostname or IP to scan. Must resolve to a public IP. |
| `port` | integer | No | TCP port for TLS handshake. Defaults to `443`. |

---

## Response

### 200 OK

Returns the TLS scan result from the hosted probe.

```json
{
  "host": "example.com",
  "port": 443,
  "reachable": true,
  "certValid": true,
  "certExpiry": "2026-08-01T00:00:00Z",
  "daysUntilExpiry": 81,
  "issuer": "Let's Encrypt",
  "subject": "CN=example.com",
  "sans": ["example.com", "www.example.com"],
  "protocol": "TLSv1.3",
  "cipherSuite": "TLS_AES_128_GCM_SHA256",
  "scannedAt": "2026-05-12T14:32:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `host` | string | The scanned hostname. |
| `port` | integer | The scanned port. |
| `reachable` | boolean | Whether the host accepted a TLS connection. |
| `certValid` | boolean | Whether the certificate chain is valid and trusted. |
| `certExpiry` | string (ISO 8601) | Certificate expiration time. |
| `daysUntilExpiry` | integer | Days remaining until expiry. Negative if already expired. |
| `issuer` | string | Common name of the issuing CA. |
| `subject` | string | Certificate subject DN. |
| `sans` | string[] | Subject Alternative Names on the certificate. |
| `protocol` | string | Negotiated TLS protocol version (e.g., `TLSv1.3`). |
| `cipherSuite` | string | Negotiated cipher suite. |
| `scannedAt` | string (ISO 8601) | Timestamp of the scan. |

### Error Responses

| Status | Reason |
|--------|--------|
| `400 Bad Request` | Missing `host`, or `host` resolves to a private/reserved IP address (SSRF blocked). |
| `429 Too Many Requests` | Rate limit exceeded for this IP address. |
| `502 Bad Gateway` | Hosted probe is unreachable or returned an unexpected response. |
| `504 Gateway Timeout` | Probe did not respond within the allowed window. |

---

## Implementation Notes

### Module

The endpoint is implemented in `PublicScanModule` (`src/public-scan/`).

### Probe Forwarding

After SSRF validation, the API forwards the request to the hosted probe's `POST /scan` endpoint using `@nestjs/axios`. The probe is selected from the region pool; for the public endpoint the default region is used.

### Environment Variables

No additional environment variables are required for the public endpoint itself. The hosted probe it forwards to must have `KK_PROBE_SCAN_API_ENABLED=true` and a valid `KK_PROBE_SCAN_API_SECRET` configured.

### Rate Limiting Configuration

Rate limit thresholds are configured in the API gateway / reverse proxy layer, not within the NestJS application itself. Adjust your nginx or Cloudflare rate limit rules as needed.

---

## Example

```bash
curl -s -X POST https://api.krakenkey.com/public/scan \
  -H 'Content-Type: application/json' \
  -d '{"host": "example.com", "port": 443}' | jq .
```

---

## Related

- [Probe On-Demand Scan API](../../probe/README.md#on-demand-scan-api) — the internal endpoint this proxies to
- [Scanner page](https://krakenkey.com/scanner) — UI that uses this endpoint
- [DOMAIN_VERIFICATION_GUIDE.md](./DOMAIN_VERIFICATION_GUIDE.md)
