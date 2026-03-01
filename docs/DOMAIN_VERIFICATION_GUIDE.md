# Domain Verification Guide

Complete guide for verifying domain ownership in KrakenKey using both the web interface and API/curl.

## Overview

Domain verification proves you own a domain before KrakenKey issues TLS certificates for it. You verify ownership by adding a DNS TXT record containing a unique verification code.

---

## Method 1: Web Interface (Browser)

### Step 1: Login and Navigate to Dashboard
1. Go to `https://dev.krakenkey.io`
2. Click "Login" and authenticate via Authentik
3. You'll be redirected to the Dashboard

### Step 2: Add Your Domain
1. Scroll to the "Domain Management" section
2. In the "Add New Domain" field, enter your domain (e.g., `example.com`)
3. Click "Add Domain"
4. Your domain will appear in the list with status "⚠ Unverified"

### Step 3: Get Verification Instructions
1. Find your domain in the list
2. Click "▶ How to verify this domain" to expand instructions
3. You'll see a verification code like: `krakenkey-site-verification=abc123...`
4. Click "📋 Copy" to copy the code to clipboard

### Step 4: Add DNS TXT Record
1. Go to your DNS provider (Cloudflare, Route53, etc.)
2. Add a new TXT record:
   - **Name/Host**: `@` or leave blank (for apex domain)
   - **Value**: Paste the verification code
   - **TTL**: Auto or 300
3. Save the record

**Example for Cloudflare:**
```
Type: TXT
Name: @
Content: krakenkey-site-verification=abc123456789...
TTL: Auto
```

### Step 5: Verify Domain
1. Wait 1-5 minutes for DNS propagation
2. Click "Verify Now" button
3. If successful, status changes to "✓ Verified" (green)
4. If it fails, wait a bit longer and try again

### Step 6: Check DNS (Optional)
Test if your TXT record is visible:
```bash
dig TXT example.com +short
```

You should see your verification code in the output.

---

## Method 2: API / curl

### Prerequisites
You need either:
- **JWT Token**: Obtained from login flow
- **API Key**: Generate from Dashboard → "Generate API Key"

### Step 1: Add Domain

**Request:**
```bash
curl -X POST https://api.dev.krakenkey.io/domains \
  -H "Authorization: Bearer YOUR_JWT_OR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hostname": "example.com"}'
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "hostname": "example.com",
  "verificationCode": "krakenkey-site-verification=abc123456789...",
  "isVerified": false,
  "userId": "user-id",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Save the verification code** from the response.

### Step 2: Add DNS TXT Record

Add a TXT record to your domain's DNS with the verification code (same as web interface method).

### Step 3: List Your Domains

```bash
curl -X GET https://api.dev.krakenkey.io/domains \
  -H "Authorization: Bearer YOUR_JWT_OR_API_KEY"
```

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "hostname": "example.com",
    "verificationCode": "krakenkey-site-verification=abc123...",
    "isVerified": false,
    "userId": "user-id",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
]
```

### Step 4: Verify Domain

Wait 1-5 minutes for DNS propagation, then:

```bash
curl -X POST https://api.dev.krakenkey.io/domains/550e8400-e29b-41d4-a716-446655440000/verify \
  -H "Authorization: Bearer YOUR_JWT_OR_API_KEY"
```

**Success Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "hostname": "example.com",
  "verificationCode": "krakenkey-site-verification=abc123...",
  "isVerified": true,
  "userId": "user-id",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:32:00.000Z"
}
```

**Error Response (if TXT record not found):**
```json
{
  "statusCode": 400,
  "message": "Verification record not found in DNS TXT records.",
  "error": "Bad Request",
  "timestamp": "2024-01-15T10:32:00.000Z",
  "path": "/domains/550e8400-e29b-41d4-a716-446655440000/verify"
}
```

### Step 5: Get Domain Details

```bash
curl -X GET https://api.dev.krakenkey.io/domains/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer YOUR_JWT_OR_API_KEY"
```

### Step 6: Delete Domain (Optional)

```bash
curl -X DELETE https://api.dev.krakenkey.io/domains/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer YOUR_JWT_OR_API_KEY"
```

---

## Complete Script Example

Here's a bash script to automate the process:

```bash
#!/bin/bash

API_URL="https://api.dev.krakenkey.io"
API_KEY="your-api-key-here"
DOMAIN="example.com"

# Add domain
echo "Adding domain..."
RESPONSE=$(curl -s -X POST "$API_URL/domains" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"hostname\": \"$DOMAIN\"}")

echo "$RESPONSE" | jq .

DOMAIN_ID=$(echo "$RESPONSE" | jq -r '.id')
VERIFICATION_CODE=$(echo "$RESPONSE" | jq -r '.verificationCode')

echo ""
echo "Domain ID: $DOMAIN_ID"
echo "Verification Code: $VERIFICATION_CODE"
echo ""
echo "Add this TXT record to your DNS:"
echo "Name: @"
echo "Value: $VERIFICATION_CODE"
echo ""
echo "Press Enter when you've added the TXT record..."
read

# Verify domain
echo "Verifying domain..."
curl -s -X POST "$API_URL/domains/$DOMAIN_ID/verify" \
  -H "Authorization: Bearer $API_KEY" | jq .

echo ""
echo "Check domain status:"
curl -s -X GET "$API_URL/domains/$DOMAIN_ID" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

**Usage:**
```bash
chmod +x verify-domain.sh
./verify-domain.sh
```

---

## Troubleshooting

### Verification Fails

**Problem:** "Verification record not found in DNS TXT records"

**Solutions:**
1. **Wait longer**: DNS propagation can take 5-30 minutes
2. **Check DNS**: Run `dig TXT yourdomain.com +short` to verify the TXT record is visible
3. **Check record format**: Ensure you copied the entire verification code exactly
4. **Check record name**: Use `@` or leave blank for apex domain
5. **Check DNS provider**: Some providers require specific formatting

### DNS Lookup Failed

**Problem:** "DNS lookup failed: ENOTFOUND" or similar

**Solutions:**
1. Check domain spelling
2. Ensure domain actually exists and has nameservers configured
3. Try again in a few minutes (temporary DNS issue)

### Already Verified

**Problem:** Domain shows as already verified

**Solution:** This is fine! If `isVerified: true`, you can skip verification and proceed to request certificates.

### Permission Denied

**Problem:** 401 or 403 errors

**Solutions:**
1. Check your API key or JWT token is valid
2. Ensure you're using the correct authorization header
3. Generate a new API key if needed

---

## DNS Provider Examples

### Cloudflare
```
DNS > Records > Add record
Type: TXT
Name: @ (or leave blank)
Content: krakenkey-site-verification=...
TTL: Auto
Proxy status: DNS only
```

### AWS Route 53
```
Hosted zones > Select domain > Create record
Record name: (leave blank)
Record type: TXT
Value: "krakenkey-site-verification=..."
TTL: 300
Routing policy: Simple
```

### Google Domains / Cloud DNS
```
DNS > Manage custom records > Create new record
Host name: @
Type: TXT
TTL: 300
Data: krakenkey-site-verification=...
```

### Namecheap
```
Advanced DNS > Add New Record
Type: TXT Record
Host: @
Value: krakenkey-site-verification=...
TTL: Automatic
```

---

## API Reference

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/domains` | Add a new domain |
| GET | `/domains` | List all your domains |
| GET | `/domains/:id` | Get domain details |
| POST | `/domains/:id/verify` | Trigger verification |
| DELETE | `/domains/:id` | Delete a domain |

### Authentication

All endpoints require authentication via:
- **JWT Token**: From login flow (header: `Authorization: Bearer <jwt>`)
- **API Key**: From dashboard (header: `Authorization: Bearer <api_key>`)

### Rate Limits

Currently no rate limits for MVP, but recommended best practices:
- Don't verify more than once per minute per domain
- Don't add duplicate domains

---

## Keeping Your Domain Verified

KrakenKey performs **daily re-verification** of all verified domains at **02:00 UTC**. It repeats the same DNS TXT lookup used during initial verification.

**If your TXT record is still present**: No action taken — domain stays verified.

**If your TXT record is missing** (deleted, expired, or DNS provider changed): The domain is automatically marked as unverified. New certificate requests for that domain will be rejected until you re-add the TXT record and trigger verification again.

> **Important**: The TXT verification record must remain in your DNS indefinitely — it is not a one-time setup step.

### What to do if your domain becomes unverified

1. Re-add the TXT record to your DNS (the verification code is unchanged — find it in the dashboard or via `GET /domains/:id`)
2. Wait for DNS propagation (1–5 minutes)
3. Click **Verify Now** in the dashboard, or call `POST /domains/:id/verify`
4. Once verified, certificate issuance resumes normally

---

## Next Steps

Once your domain is verified:
1. You can submit Certificate Signing Requests (CSRs) for this domain
2. KrakenKey will automatically issue TLS certificates via Let's Encrypt
3. Certificates are delivered via the API
4. Certificates expiring within 30 days are automatically renewed daily at 06:00 UTC

See [Certificate Issuance Flow](../backend/docs/CERTIFICATE_FLOW.md) for the next steps.

---

## Development / Testing

For local testing with `.local` domains or bypassing verification:

**Backend dev mode** has a bypass (check [domains.service.ts](../backend/src/domains/domains.service.ts)):
```typescript
// DEV ONLY: Auto-verify if domain ends with .local
if (process.env.NODE_ENV === 'dev' && domain.hostname.endsWith('.local')) {
  domain.isVerified = true;
  return await this.domainsRepository.save(domain);
}
```

Add this feature if you need quick testing without DNS setup!

---

## Files Modified/Created

**Frontend:**
- ✅ [frontend/src/components/DomainManagement.tsx](../frontend/src/components/DomainManagement.tsx) - Main component
- ✅ [frontend/src/components/DomainManagement.css](../frontend/src/components/DomainManagement.css) - Styles
- ✅ [frontend/src/pages/Dashboard.tsx](../frontend/src/pages/Dashboard.tsx) - Integration
- ✅ [shared/src/constants/routes.ts](../shared/src/constants/routes.ts) - Added DELETE route

**Backend:**
- No changes needed (already implemented)

**Documentation:**
- ✅ [docs/DOMAIN_VERIFICATION_GUIDE.md](./DOMAIN_VERIFICATION_GUIDE.md) - This file
