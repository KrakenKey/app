# Endpoint Monitoring

KrakenKey can monitor TLS endpoints (servers) to track certificate expiry, trust status, and connection health. Endpoints are scanned by probes — either managed cloud probes or your own connected probe instances.

## Concepts

| Term | Description |
|------|-------------|
| **Endpoint** | A hostname + port combination to monitor (e.g. `api.example.com:443`) |
| **Probe** | A service that connects to endpoints and reports TLS scan results |
| **Managed (Hosted) Probe** | Cloud-hosted probe in a specific region, provided by KrakenKey |
| **Connected Probe** | Your own self-hosted probe instance, registered via service API key |
| **Scan** | A single TLS connection + certificate inspection by a probe |
| **Scan Result** | Certificate details, expiry, trust chain, connection latency from a scan |

## Plan Limits

| Feature | Starter (`free`) | Pro | Business | Enterprise |
|---------|------------------|-----|----------|------------|
| Endpoints | 3 | 50 | 300 | Custom |
| Hosted Probe Regions | 1 | All running | All running | All running |
| Hosted Endpoints | 1 | 25 | 150 | Custom |
| Hosted Scan Interval | 60 min | 30 min | 5 min | 1 min |
| Connected scan interval (minimum) | 60 min | 15 min | 1 min | 1 min |
| Scan result retention | 7 days | 30 days | 90 days | 90 days |

## Scan Intervals

Scan intervals follow the endpoint owner's plan (the organization's plan for an org member):

| | Starter (`free`) | Pro | Business | Enterprise |
|---|---|---|---|---|
| Hosted probes scan every | 60 min | 30 min | 5 min | 1 min |
| Connected probes, shortest interval | 60 min | 15 min | 1 min | 1 min |

`GET /probes/:probeId/config` returns each endpoint with its `interval` (Go duration syntax, for example `"30m"`): for a hosted probe, how often to scan the endpoint; for a connected probe, the shortest interval the API accepts (the probe's own `KK_PROBE_INTERVAL` still applies when it is longer). The top-level `interval` is the shortest endpoint interval, or `60m` with no endpoints. `KK_PROBE_HOSTED_INTERVAL` is no longer read.

```json
{
  "endpoints": [
    { "host": "example.com", "port": 443, "sni": "example.com", "userId": "...", "interval": "30m" }
  ],
  "interval": "30m"
}
```

`POST /probes/report` skips a result that arrives sooner than the interval after the previous result from the same probe for the same endpoint (measured when the API receives it, with 10% or at least 10 seconds of slack), unless a scan was requested for the endpoint since (`POST /endpoints/:id/scan`). The response counts them: `{ "accepted": 3, "tooSoon": 1 }`. This applies whatever the probe version: probes before per-endpoint intervals scan everything at their local interval, so a connected probe set faster than its plan allows has the extra results skipped, and a hosted probe on an older version scans at its local interval until it is upgraded.

## API Endpoints

### Create Endpoint

```
POST /endpoints
```

**Request:**
```json
{
  "host": "api.example.com",
  "port": 443,
  "sni": "api.example.com",
  "label": "Production API",
  "probeIds": ["probe-uuid-1"],
  "hostedRegions": ["us-east-1"]
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `host` | Yes | — | Hostname or IP to connect to |
| `port` | Yes | — | Port number (typically 443) |
| `sni` | No | — | Server Name Indication override |
| `label` | No | — | Friendly name for the endpoint |
| `probeIds` | No | `[]` | Connected probe IDs to assign |
| `hostedRegions` | No | `[]` | Managed probe regions to enable |

### List Endpoints

```
GET /endpoints
```

Returns all endpoints owned by the user (or organization).

### Get Endpoint

```
GET /endpoints/:id
```

### Update Endpoint

```
PATCH /endpoints/:id
```

**Request:**
```json
{
  "label": "Updated Label",
  "sni": "new-sni.example.com",
  "isActive": false
}
```

### Delete Endpoint

```
DELETE /endpoints/:id
```

### Request Scan

Trigger an immediate scan for an endpoint across all assigned probes.

```
POST /endpoints/:id/scan
```

After requesting a scan, poll the results endpoint. The frontend auto-polls every 10 seconds for up to 60 seconds.

### Get Scan Results

```
GET /endpoints/:id/results
```

Returns paginated scan results from all assigned probes.

### Get Latest Results

```
GET /endpoints/:id/results/latest
```

Returns the most recent scan result from each assigned probe.

### Export Results

```
GET /endpoints/:id/results/export?format=csv
GET /endpoints/:id/results/export?format=json
```

Download scan results as CSV or JSON.

## Probe Management

### List Your Probes

```
GET /endpoints/probes/mine
```

Returns all connected probes available to the user.

### Assign Probes

```
POST /endpoints/:id/probes
```

**Request:**
```json
{
  "probeIds": ["probe-uuid-1", "probe-uuid-2"]
}
```

### Unassign Probe

```
DELETE /endpoints/:id/probes/:probeId
```

## Hosted Region Management

### Add Hosted Region

```
POST /endpoints/:id/regions
```

**Request:**
```json
{
  "region": "us-east-1"
}
```

Subject to plan-based hosted limits. The region limit counts distinct regions in use across the account, so adding a region that another endpoint already uses does not count against it. The hosted endpoint limit counts endpoints with at least one hosted region.

### Remove Hosted Region

```
DELETE /endpoints/:id/regions/:region
```

## Scan Results

Each scan result includes:

| Field | Description |
|-------|-------------|
| Certificate chain | Full certificate chain from the server |
| Expiry date | Certificate expiration timestamp |
| Trust status | Whether the certificate is trusted by the probe's root store |
| Connection success | Whether the TLS handshake completed |
| Latency | Connection time in milliseconds |
| Probe ID | Which probe performed the scan |
| Scanned at | Timestamp of the scan |

### Expiry Indicators

The UI displays color-coded badges:
- **Red** (danger): Expires within 7 days
- **Yellow** (warning): Expires within 30 days
- **Green** (success): More than 30 days until expiry

## Endpoint Entity Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `host` | varchar | Hostname or IP |
| `port` | integer | Port number |
| `sni` | varchar | SNI override (nullable) |
| `label` | varchar | Friendly name (nullable) |
| `isActive` | boolean | Whether scanning is enabled (default: true) |
| `lastScanRequestedAt` | timestamp | Last manual scan request (nullable) |
| `ownerId` | varchar | Owner user ID |

### Related Entities

**EndpointHostedRegion** — join table for managed probe regions:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `endpointId` | UUID | Endpoint reference |
| `region` | varchar | Cloud region identifier |

Unique constraint on `(endpointId, region)`.

**EndpointProbeAssignment** — join table for connected probes:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `endpointId` | UUID | Endpoint reference |
| `probeId` | UUID | Probe reference |

Unique constraint on `(endpointId, probeId)`.
