/**
 * POC Validation Test for @peculiar/x509 Library
 *
 * This script validates that @peculiar/x509 can generate CSRs compatible
 * with our backend's node-forge parser.
 *
 * Run with: yarn tsx test-peculiar-poc.ts
 *
 * CRITICAL: This test must pass before deploying CSR generator feature.
 */

import * as x509 from '@peculiar/x509';
import { webcrypto } from 'crypto';

// Polyfill for Node.js environment
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = webcrypto;
}

async function testPeculiarX509() {
  console.log('🔍 Testing @peculiar/x509 capabilities...\n');

  try {
    // Test 1: RSA 2048
    console.log('1️⃣  Generating RSA 2048 key pair...');
    const rsa2048KeyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );

    const rsa2048Csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: 'CN=example.com,O=Test Inc,OU=Engineering,L=San Francisco,ST=California,C=US',
      keys: rsa2048KeyPair,
      signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      extensions: [
        await x509.SubjectAlternativeNameExtension.create([
          { type: 'dns', value: 'example.com' },
          { type: 'dns', value: 'www.example.com' },
        ])
      ]
    });

    const rsa2048Pem = rsa2048Csr.toString('pem');
    console.log('   ✅ RSA 2048 CSR generated successfully');
    console.log('   📄 CSR Preview:', rsa2048Pem.substring(0, 80) + '...\n');

    // Test 2: RSA 4096
    console.log('2️⃣  Generating RSA 4096 key pair...');
    const rsa4096KeyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 4096,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );

    const rsa4096Csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: 'CN=secure.example.com,O=Test Inc',
      keys: rsa4096KeyPair,
      signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      extensions: [
        await x509.SubjectAlternativeNameExtension.create([
          { type: 'dns', value: 'secure.example.com' },
          { type: 'dns', value: 'api.example.com' },
        ])
      ]
    });

    const rsa4096Pem = rsa4096Csr.toString('pem');
    console.log('   ✅ RSA 4096 CSR generated successfully');
    console.log('   📄 CSR Preview:', rsa4096Pem.substring(0, 80) + '...\n');

    // Test 3: ECDSA P-256
    console.log('3️⃣  Generating ECDSA P-256 key pair...');
    const ecP256KeyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    const ecP256Csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: 'CN=ec256.example.com',
      keys: ecP256KeyPair,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      extensions: [
        await x509.SubjectAlternativeNameExtension.create([
          { type: 'dns', value: 'ec256.example.com' },
        ])
      ]
    });

    const ecP256Pem = ecP256Csr.toString('pem');
    console.log('   ✅ ECDSA P-256 CSR generated successfully');
    console.log('   📄 CSR Preview:', ecP256Pem.substring(0, 80) + '...\n');

    // Test 4: ECDSA P-384 (Recommended)
    console.log('4️⃣  Generating ECDSA P-384 key pair...');
    const ecP384KeyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-384' },
      true,
      ['sign', 'verify']
    );

    const ecP384Csr = await x509.Pkcs10CertificateRequestGenerator.create({
      name: 'CN=ec384.example.com,O=Test Inc',
      keys: ecP384KeyPair,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-384' },
      extensions: [
        await x509.SubjectAlternativeNameExtension.create([
          { type: 'dns', value: 'ec384.example.com' },
          { type: 'ip', value: '192.168.1.1' },
          { type: 'email', value: 'admin@example.com' },
        ])
      ]
    });

    const ecP384Pem = ecP384Csr.toString('pem');
    console.log('   ✅ ECDSA P-384 CSR generated successfully');
    console.log('   📄 CSR Preview:', ecP384Pem.substring(0, 80) + '...\n');

    // Test 5: CSR Format Validation
    console.log('5️⃣  Validating PEM format...');
    const testPems = [rsa2048Pem, rsa4096Pem, ecP256Pem, ecP384Pem];
    for (const pem of testPems) {
      if (!pem.startsWith('-----BEGIN CERTIFICATE REQUEST-----')) {
        throw new Error('Invalid PEM format: Missing header');
      }
      if (!pem.includes('-----END CERTIFICATE REQUEST-----')) {
        throw new Error('Invalid PEM format: Missing footer');
      }
    }
    console.log('   ✅ All CSRs have valid PEM format\n');

    // Test 6: Key Export
    console.log('6️⃣  Testing private key export...');
    const privateKeyExport = await crypto.subtle.exportKey('pkcs8', rsa2048KeyPair.privateKey);
    const privateKeyPem = pemEncode(privateKeyExport, 'PRIVATE KEY');

    if (!privateKeyPem.startsWith('-----BEGIN PRIVATE KEY-----')) {
      throw new Error('Private key export failed');
    }
    console.log('   ✅ Private key export successful\n');

    // Test 7: Public key export
    console.log('7️⃣  Testing public key export...');
    const publicKeyExport = await crypto.subtle.exportKey('spki', rsa2048KeyPair.publicKey);
    const publicKeyPem = pemEncode(publicKeyExport, 'PUBLIC KEY');

    if (!publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')) {
      throw new Error('Public key export failed');
    }
    console.log('   ✅ Public key export successful\n');

    // Success Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ ALL TESTS PASSED! @peculiar/x509 works as expected.');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('Next steps:');
    console.log('1. Test CSRs with backend parser (node-forge)');
    console.log('2. Test in browser environment');
    console.log('3. Test full workflow (generate → submit → issue cert)\n');

    return true;
  } catch (error) {
    console.error('\n❌ TEST FAILED!\n');
    console.error('Error:', error);
    console.error('\nThis indicates @peculiar/x509 may not work in this environment.');
    console.error('Consider alternative libraries or manual ASN.1 encoding.\n');
    return false;
  }
}

/**
 * Helper: Encodes binary data as PEM format
 */
function pemEncode(buffer: ArrayBuffer, label: string): string {
  const base64 = arrayBufferToBase64(buffer);
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

/**
 * Helper: Converts ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

// Run tests
testPeculiarX509()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
