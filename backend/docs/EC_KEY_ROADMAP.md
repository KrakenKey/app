# EC Key Support Roadmap

## Current State

ECDSA P-256 and P-384 are fully supported end-to-end:

| Layer | RSA-2048/4096 | ECDSA P-256 | ECDSA P-384 | ECDSA P-521 | Ed25519/Ed448 |
|-------|:---:|:---:|:---:|:---:|:---:|
| Shared `KeyType` | Yes | Yes | Yes | No | No |
| Frontend keygen (WebCrypto) | Yes | Yes | Yes | No | No |
| Frontend CSR creation | Yes | Yes | Yes | No | No |
| Backend CSR parsing (node-forge) | Yes | Yes | Yes | Yes | No |
| ACME issuance | Yes | Yes | Yes | Yes | No |

## Phase 1 — ECDSA P-521

**Goal:** Add P-521 as an option for users who need the strongest NIST curve.

### Changes

1. **`shared/src/types/csr-generator.ts`** — Add `'ECDSA-P521'` to the `KeyType` union.

2. **`frontend/src/utils/csrGenerator.ts`** — Add `ECDSA-P521` case to `generateKeyPair()` (WebCrypto `namedCurve: 'P-521'`), `createCsr()` signing algorithm (`SHA-512`), `generateCsr()` key size mapping, `getSecurityLevel()` (~256-bit security), and `getGenerationTime()`.

3. **`frontend/src/components/CsrGenerator.tsx`** — Add P-521 radio button option to key type selector.

### Notes

- Backend already parses P-521 CSRs (OID `1.3.132.0.35`), so no backend changes needed.
- Let's Encrypt accepts P-521 subscriber keys.
- WebCrypto supports P-521 in all major browsers.
- P-521 is slower to generate than P-384 with marginal practical security gain, so P-384 should remain the recommended default.

## Phase 2 — Ed25519 / Ed448 (EdDSA)

**Goal:** Support Edwards-curve keys for users who want modern, high-performance signatures.

### Blockers

- **Let's Encrypt does not accept EdDSA subscriber certificates.** This is the primary blocker. Until LE (or an alternative CA) supports EdDSA certs, this phase only applies to self-signed or private CA workflows.
- **node-forge has no EdDSA support.** CSR parsing would need to move to a different library (e.g., `@peculiar/asn1-*` or `node:crypto`).
- **WebCrypto has no Ed25519/Ed448 support** in the standard API. Generation would require a userland library like `@noble/ed25519` or the `Ed25519` algorithm available behind flags in some browsers.

### Changes (once blockers are resolved)

1. **`shared/src/types/csr-generator.ts`** — Add `'Ed25519'` and/or `'Ed448'` to `KeyType`.

2. **`frontend/src/utils/csrGenerator.ts`** — Add keygen using `@noble/ed25519` or equivalent. CSR creation would need `@peculiar/x509` EdDSA signing support (already available via `Ed25519` algorithm name).

3. **`backend/src/certs/tls/util/csr-util.service.ts`** — Replace or supplement node-forge CSR parsing with a library that understands EdDSA keys. Options:
   - `node:crypto` — Has `createPublicKey()` which can parse EdDSA SPKI keys and verify signatures.
   - `@peculiar/x509` — Already used on the frontend; could be used on the backend too.

4. **`backend/src/certs/tls/strategies/`** — If a non-ACME issuer strategy is added (e.g., private CA), it would need to handle EdDSA CSRs.

5. **`frontend/src/components/CsrGenerator.tsx`** — Add Ed25519/Ed448 options with appropriate descriptions.

### Key differences from ECDSA

| Property | ECDSA (P-256/384/521) | EdDSA (Ed25519/Ed448) |
|----------|----------------------|----------------------|
| Curve type | Weierstrass (NIST) | Edwards (Bernstein) |
| Signature scheme | ECDSA | EdDSA (deterministic) |
| Performance | Fast | Faster |
| Key size | 32/48/66 bytes | 32/57 bytes |
| Security level | 128/192/256-bit | ~128/~224-bit |
| Let's Encrypt support | Yes | No (as of 2026) |
| WebCrypto standard | Yes | Partial (proposal stage) |

## Phase 3 — EC ACME Account Key

**Goal:** Use an EC key for the ACME account instead of RSA, reducing overhead on every ACME request.

### Changes

1. **`backend/src/certs/tls/strategies/acme-issuer.strategy.ts`** — When initializing the ACME client, generate or load an EC P-256 account key instead of RSA. The `acme-client` library supports this via `forge.pki.ed25519` or by passing a JWK directly.

2. **Configuration** — Add `ACME_ACCOUNT_KEY_TYPE` env var (default `EC-P256`, fallback `RSA-2048`). Existing RSA account keys should continue to work (no forced migration).

### Notes

- ACME account keys are independent of subscriber certificate keys.
- Let's Encrypt recommends EC account keys for performance.
- This is a backend-only change with no user-facing impact.

## Priority

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| 1 — P-521 | Low (frontend-only) | Low (niche use case) | Low |
| 2 — Ed25519/Ed448 | High (library changes, blocked by LE) | Medium (future-proofing) | Deferred |
| 3 — EC account key | Low (backend config) | Medium (performance) | Medium |

Recommended order: **Phase 3 > Phase 1 > Phase 2**
