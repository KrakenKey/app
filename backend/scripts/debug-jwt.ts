import { JwksClient } from 'jwks-rsa';
import * as jwt from 'jsonwebtoken';

// Hardcoded for reproduction based on logs/env
const JWKS_URI = 'https://auth.dev.krakenkey.io/application/o/krakenkey/jwks/';
const TOKEN = process.argv[2]; // Pass token as arg

async function test() {
  console.log('--- JWT Debugger ---');
  console.log(`Using JWKS URI: ${JWKS_URI}`);

  if (!TOKEN) {
    console.error('Please provide a token as an argument');
    process.exit(1);
  }

  const client = new JwksClient({
    jwksUri: JWKS_URI,
    requestHeaders: {}, // Empty headers
    timeout: 30000,
  });

  // 1. Decode generic (unverified)
  const decoded = jwt.decode(TOKEN, { complete: true });
  if (!decoded) {
    console.error('Failed to decode token structure. Is it a valid JWT?');
    process.exit(1);
  }
  console.log('Token Header:', decoded.header);
  console.log('Token Payload:', decoded.payload);

  const kid = decoded.header.kid;
  if (!kid) {
    console.error('No kid in header!');
    process.exit(1);
  }

  // 2. Fetch Key
  try {
    console.log(`Fetching key for kid: ${kid}...`);
    const key = await client.getSigningKey(kid);
    const signingKey = key.getPublicKey();
    console.log('Successfully fetched public key.');

    // 3. Verify
    console.log('Verifying signature...');
    const verified = jwt.verify(TOKEN, signingKey, { algorithms: ['RS256'] });
    console.log('✅ Token Verified Successfully!');
    console.log(verified);
  } catch (err) {
    console.error('❌ Verification Failed:', err);
    if (err.code === 'ECONNREFUSED') {
      console.error('Connection refused to JWKS endpoint. Check DNS/Network.');
    }
  }
}

test();
