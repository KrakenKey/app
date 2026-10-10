import { BadRequestException } from '@nestjs/common';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from 'crypto';
import { FindOperator } from 'typeorm';
import {
  rotateMessage,
  tokenMessage,
} from '../../src/connectors/connector-crypto';

/**
 * In-memory stand-ins for the connector tables, the short-lived key store
 * and the nonce store, so e2e tests can run the real ConnectorsService and
 * real auth guards end to end without Postgres or Redis.
 */

type Row = Record<string, any>;

function matches(row: Row, criteria: Row): boolean {
  return Object.entries(criteria).every(([k, v]) => {
    if (v instanceof FindOperator) {
      if (v.type === 'isNull') return row[k] === null || row[k] === undefined;
      if (v.type === 'in') return (v.value as unknown[]).includes(row[k]);
      throw new Error(`fake repo: unsupported operator ${v.type}`);
    }
    // uuids compare case-insensitively in Postgres
    if (k === 'id' && typeof v === 'string' && typeof row[k] === 'string') {
      return row[k].toLowerCase() === v.toLowerCase();
    }
    return row[k] === v;
  });
}

export class FakeConnectorRepo {
  rows: Row[] = [];

  create(v: Row): Row {
    return { ...v };
  }

  async save(v: Row): Promise<Row> {
    v.id ??= randomUUID();
    v.createdAt ??= new Date();
    this.rows.push(v);
    return v;
  }

  async find({ where }: { where: Row }): Promise<Row[]> {
    return this.rows
      .filter((r) => matches(r, where))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ ...r }));
  }

  async findOne({ where }: { where: Row }): Promise<Row | null> {
    const r = this.rows.find((x) => matches(x, where));
    return r ? { ...r } : null;
  }

  async count({ where }: { where: Row }): Promise<number> {
    return this.rows.filter((r) => matches(r, where)).length;
  }

  async update(criteria: Row | string, changes: Row) {
    const where = typeof criteria === 'string' ? { id: criteria } : criteria;
    const hit = this.rows.filter((r) => matches(r, where));
    for (const r of hit) Object.assign(r, changes);
    return { affected: hit.length };
  }

  /**
   * The enrolment UPDATE ... RETURNING. Runs synchronously inside
   * execute(), like the single SQL statement it stands for, so two
   * concurrent enrolments can't both match.
   */
  createQueryBuilder() {
    let values: Row = {};
    let params: Row = {};
    const conditions: string[] = [];
    const qb = {
      update: () => qb,
      set: (v: Row) => ((values = v), qb),
      where: (c: string, p: Row) => (
        conditions.push(c),
        (params = { ...params, ...p }),
        qb
      ),
      andWhere: (c: string, p: Row = {}) => (
        conditions.push(c),
        (params = { ...params, ...p }),
        qb
      ),
      returning: () => qb,
      execute: async () => {
        const expected = [
          '"enrolmentTokenHash" = :hash',
          '"enrolmentTokenExpiresAt" > :now',
          '"enrolledAt" IS NULL',
          '"revokedAt" IS NULL',
        ];
        if (conditions.join('|') !== expected.join('|')) {
          throw new Error(
            `fake repo: unexpected update ${conditions.join(' AND ')}`,
          );
        }
        const row = this.rows.find(
          (r) =>
            r.enrolmentTokenHash === params.hash &&
            r.enrolmentTokenExpiresAt > params.now &&
            !r.enrolledAt &&
            !r.revokedAt,
        );
        if (!row) return { raw: [] };
        Object.assign(row, values);
        return { raw: [{ id: row.id, name: row.name, userId: row.userId }] };
      },
    };
    return qb;
  }
}

export interface FakeKey {
  id: string;
  user: { id: string; groups: string[] };
  source: string | null;
  connectorId: string | null;
  scopes: string[] | null;
  allowedCertIds: number[] | null;
  allowedDomainIds: string[] | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** The parts of AuthService connectors and ApiKeyStrategy use. */
export class FakeAuthService {
  keys = new Map<string, FakeKey>();

  constructor(
    private readonly owned: { certIds: number[]; domainIds: string[] },
  ) {}

  hashSecret(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async validateRestrictions(
    _userId: string,
    r: { allowedCertIds?: number[]; allowedDomainIds?: string[] },
  ) {
    const certs = r.allowedCertIds?.length
      ? [...new Set(r.allowedCertIds)]
      : null;
    const domains = r.allowedDomainIds?.length
      ? [...new Set(r.allowedDomainIds)]
      : null;
    const badCerts = (certs ?? []).filter(
      (id) => !this.owned.certIds.includes(id),
    );
    if (badCerts.length) {
      throw new BadRequestException(
        `Unknown certificate id(s): ${badCerts.join(', ')}`,
      );
    }
    const badDomains = (domains ?? []).filter(
      (id) => !this.owned.domainIds.includes(id),
    );
    if (badDomains.length) {
      throw new BadRequestException(
        `Unknown domain id(s): ${badDomains.join(', ')}`,
      );
    }
    return {
      scopes: null,
      allowedCertIds: certs,
      allowedDomainIds: domains,
      allowedIps: null,
    };
  }

  async createEphemeralApiKey(
    userId: string,
    _name: string,
    source: string,
    ttlSeconds: number,
    restrictions: {
      scopes: string[] | null;
      allowedDomainIds: string[] | null;
      allowedCertIds: number[] | null;
    },
    options: { connectorId?: string } = {},
  ) {
    const apiKey = `kk_${randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const id = randomUUID();
    this.keys.set(apiKey, {
      id,
      user: { id: userId, groups: [] },
      source,
      connectorId: options.connectorId ?? null,
      ...restrictions,
      expiresAt,
      revokedAt: null,
    });
    return { id, apiKey, expiresAt };
  }

  /** A dashboard-made key, for tests that need one. */
  addKey(raw: string, userId: string, fields: Partial<FakeKey> = {}) {
    this.keys.set(raw, {
      id: randomUUID(),
      user: { id: userId, groups: [] },
      source: null,
      connectorId: null,
      scopes: null,
      allowedCertIds: null,
      allowedDomainIds: null,
      expiresAt: null,
      revokedAt: null,
      ...fields,
    });
  }

  async revokeConnectorKeys(connectorId: string): Promise<number> {
    let n = 0;
    for (const k of this.keys.values()) {
      if (k.connectorId === connectorId && !k.revokedAt) {
        k.revokedAt = new Date();
        n++;
      }
    }
    return n;
  }

  async validateApiKey(raw: string) {
    const k = this.keys.get(raw);
    if (!k || k.revokedAt) return null;
    if (k.expiresAt && k.expiresAt < new Date()) return null;
    return k;
  }
}

export class FakeNonceStore {
  private readonly seen = new Set<string>();

  async claim(connectorId: string, nonce: string): Promise<boolean> {
    const key = `${connectorId.toLowerCase()}:${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

/** An Ed25519 key pair as a connector would hold it. */
export function connectorKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x!;
  const publicB64 = Buffer.from(x, 'base64url').toString('base64');
  const signB64 = (msg: string) =>
    sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('base64');
  return { publicB64, signB64 };
}

export type ConnectorKey = ReturnType<typeof connectorKey>;

export function rfc3339(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
}

export function newNonce(): string {
  return randomBytes(16).toString('base64url');
}

export function tokenRequest(
  key: ConnectorKey,
  connectorId: string,
  over: { timestamp?: string; nonce?: string; signedId?: string } = {},
) {
  const timestamp = over.timestamp ?? rfc3339();
  const nonce = over.nonce ?? newNonce();
  return {
    connectorId,
    timestamp,
    nonce,
    signature: key.signB64(
      tokenMessage(over.signedId ?? connectorId, timestamp, nonce),
    ),
  };
}

export function rotateRequest(
  signer: ConnectorKey,
  connectorId: string,
  newPublicKey: string,
) {
  const timestamp = rfc3339();
  const nonce = newNonce();
  return {
    connectorId,
    newPublicKey,
    timestamp,
    nonce,
    signature: signer.signB64(
      rotateMessage(connectorId, newPublicKey, timestamp, nonce),
    ),
  };
}
