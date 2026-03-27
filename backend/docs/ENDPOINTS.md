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

| Feature | Free | Starter | Team | Business | Enterprise |
|---------|------|---------|------|----------|------------|
| Endpoints | 3 | 10 | 25 | 75 | Unlimited |
| Hosted Probe Regions | — | — | 5 | 15 | Unlimited |
| Hosted Endpoints | — | — | — | 100 | Unlimited |
| Scan Interval | 60 min | 30 min | 5 min | 1 min | Custom |

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

Subject to plan-based hosted region limits.

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
