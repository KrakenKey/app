import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import {
  CONNECTOR_ENROLLMENT_TOKEN_PREFIX,
  CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS,
  CONNECTOR_KEY_TTL_SECONDS,
  CONNECTOR_MAX_CLOCK_SKEW_SECONDS,
  MAX_CONNECTORS_PER_USER,
  type Connector as ConnectorDto,
  type ConnectorConfigSummary,
  type ConnectorEnrollResponse,
  type ConnectorEnrollmentTokenResponse,
  type ConnectorScope,
  type ConnectorTokenResponse,
  type CreateConnectorResponse,
} from '@krakenkey/shared';
import { Connector } from './entities/connector.entity';
import { AuthService } from '../auth/auth.service';
import { BillingService } from '../billing/billing.service';
import { ConnectorNonceStore } from './connector-nonce.store';
import {
  parsePublicKey,
  parseTimestamp,
  rotateMessage,
  tokenMessage,
  verifySignature,
} from './connector-crypto';
import type {
  ConnectorEnrollDto,
  ConnectorRotateDto,
  ConnectorTokenDto,
  CreateConnectorDto,
  UpdateConnectorDto,
} from './dto/connector.dto';
import type { ConnectorConfigDto } from './dto/connector-config.dto';
import type { KeyUser } from '../auth/access/api-key-access.service';

/** Every enrollment failure gets this, so a caller learns nothing about why. */
export const INVALID_ENROLLMENT_TOKEN = 'Invalid enrollment token';
/** Every token or rotate failure gets this. */
export const INVALID_CONNECTOR_CREDENTIALS = 'Invalid connector credentials';

/** Source recorded on keys issued to connectors. */
export const CONNECTOR_KEY_SOURCE = 'connector';

/** kkce_ + base64url of 32 random bytes. */
function newEnrollmentToken(): string {
  return `${CONNECTOR_ENROLLMENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);

  constructor(
    @InjectRepository(Connector)
    private readonly connectorRepo: Repository<Connector>,
    private readonly authService: AuthService,
    private readonly billingService: BillingService,
    private readonly nonces: ConnectorNonceStore,
  ) {}

  // --- Dashboard ------------------------------------------------------------

  async list(userId: string): Promise<ConnectorDto[]> {
    const connectors = await this.connectorRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return connectors.map(toDto);
  }

  /** One connector, with the config summary it last shared. */
  async get(userId: string, id: string): Promise<ConnectorDto> {
    const connector = await this.findOwned(userId, id);
    // configSummary isn't loaded by default; fetch it only when one is stored
    const stored = connector.configHash
      ? await this.connectorRepo.findOne({
          where: { id, userId },
          select: { id: true, configSummary: true },
        })
      : null;
    return {
      ...toDto(connector),
      configSummary: stored?.configSummary ?? null,
      configHash: connector.configHash ?? null,
      configReportedAt: connector.configReportedAt
        ? connector.configReportedAt.toISOString()
        : null,
    };
  }

  async create(
    userId: string,
    dto: CreateConnectorDto,
  ): Promise<CreateConnectorResponse> {
    const scopes = [...new Set(dto.scopes)];
    if (!scopes.includes('certs:read')) {
      throw new BadRequestException('scopes must include certs:read');
    }
    const limits = await this.authService.validateRestrictions(userId, {
      allowedCertIds: dto.allowedCertIds,
      allowedDomainIds: dto.allowedDomainIds,
    });
    if (!limits.allowedCertIds && !limits.allowedDomainIds) {
      throw new BadRequestException(
        'A connector must be limited to specific certificates or domains: set allowedCertIds or allowedDomainIds',
      );
    }

    const current = await this.connectorRepo.count({
      where: { userId, revokedAt: IsNull() },
    });
    if (current >= MAX_CONNECTORS_PER_USER) {
      const plan = await this.billingService.resolveUserTier(userId);
      throw new HttpException(
        {
          message: 'Connector limit reached',
          code: 'plan_limit_exceeded',
          limit: MAX_CONNECTORS_PER_USER,
          current,
          plan,
        },
        402,
      );
    }

    const enrollmentToken = newEnrollmentToken();
    const connector = this.connectorRepo.create({
      userId,
      name: dto.name,
      clientLabel: dto.clientLabel ?? null,
      scopes,
      allowedCertIds: limits.allowedCertIds,
      allowedDomainIds: limits.allowedDomainIds,
      publicKey: null,
      enrollmentTokenHash: this.authService.hmacSecret(enrollmentToken),
      enrollmentTokenExpiresAt: tokenExpiry(),
      enrolledAt: null,
      revokedAt: null,
      lastSeenAt: null,
      staleAlertedAt: null,
      version: null,
      os: null,
      arch: null,
      configHash: null,
      configReportedAt: null,
    });
    await this.connectorRepo.save(connector);
    this.logger.log(`Connector ${connector.id} created by user ${userId}`);
    return {
      connector: toDto(connector),
      enrollmentToken,
      expiresAt: connector.enrollmentTokenExpiresAt!.toISOString(),
    };
  }

  /**
   * Replaces the enrollment token of a connector that has not enrolled yet.
   * The previous token, used or not, stops working.
   */
  async reissueEnrollmentToken(
    userId: string,
    id: string,
  ): Promise<ConnectorEnrollmentTokenResponse> {
    const connector = await this.findOwned(userId, id);
    if (connector.revokedAt) {
      throw new ConflictException('This connector has been revoked');
    }
    if (connector.enrolledAt) {
      throw new ConflictException('This connector has already enrolled');
    }
    const enrollmentToken = newEnrollmentToken();
    const expiresAt = tokenExpiry();
    const result = await this.connectorRepo.update(
      { id, userId, enrolledAt: IsNull(), revokedAt: IsNull() },
      {
        enrollmentTokenHash: this.authService.hmacSecret(enrollmentToken),
        enrollmentTokenExpiresAt: expiresAt,
      },
    );
    if (!result.affected) {
      // Enrolled or revoked since the read above
      throw new ConflictException('This connector has already enrolled');
    }
    return { enrollmentToken, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Changes a connector's name, client label, scopes or restrictions.
   * Scopes and restrictions get the same checks as at creation. Changing
   * any of them revokes the connector's live keys, so its next key
   * exchange carries the new limits.
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateConnectorDto,
  ): Promise<ConnectorDto> {
    const connector = await this.findOwned(userId, id);
    if (connector.revokedAt) {
      throw new ConflictException('This connector has been revoked');
    }
    const changes: {
      name?: string;
      clientLabel?: string | null;
      scopes?: ConnectorScope[];
      allowedCertIds?: number[] | null;
      allowedDomainIds?: string[] | null;
    } = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.clientLabel !== undefined) changes.clientLabel = dto.clientLabel;

    if (dto.scopes !== undefined && dto.scopes !== null) {
      const scopes = [...new Set(dto.scopes)];
      if (!scopes.includes('certs:read')) {
        throw new BadRequestException('scopes must include certs:read');
      }
      if (!sameSet(scopes, connector.scopes)) changes.scopes = scopes;
    }
    const certsGiven = dto.allowedCertIds !== undefined;
    const domainsGiven = dto.allowedDomainIds !== undefined;
    if (certsGiven || domainsGiven) {
      // Only the lists being replaced are checked against the account
      const limits = await this.authService.validateRestrictions(userId, {
        allowedCertIds: dto.allowedCertIds ?? undefined,
        allowedDomainIds: dto.allowedDomainIds ?? undefined,
      });
      const certIds = certsGiven
        ? limits.allowedCertIds
        : connector.allowedCertIds;
      const domainIds = domainsGiven
        ? limits.allowedDomainIds
        : connector.allowedDomainIds;
      if (!certIds && !domainIds) {
        throw new BadRequestException(
          'A connector must be limited to specific certificates or domains: keep allowedCertIds or allowedDomainIds',
        );
      }
      if (certsGiven && !sameSet(certIds, connector.allowedCertIds)) {
        changes.allowedCertIds = certIds;
      }
      if (domainsGiven && !sameSet(domainIds, connector.allowedDomainIds)) {
        changes.allowedDomainIds = domainIds;
      }
    }

    if (Object.keys(changes).length) {
      const result = await this.connectorRepo.update(
        { id, userId, revokedAt: IsNull() },
        changes,
      );
      if (!result.affected) {
        throw new ConflictException('This connector has been revoked');
      }
      Object.assign(connector, changes);
    }
    const limitsChanged =
      'scopes' in changes ||
      'allowedCertIds' in changes ||
      'allowedDomainIds' in changes;
    if (limitsChanged) {
      const keys = await this.authService.revokeConnectorKeys(id);
      this.logger.log(
        `Connector ${id} limits changed by user ${userId}; ${keys} live key(s) revoked`,
      );
    }
    return toDto(connector);
  }

  /**
   * Revokes a connector: it can't enroll, get keys or rotate any more, and
   * every key it was issued stops working. Revoking twice is a no-op.
   */
  async revoke(userId: string, id: string): Promise<void> {
    const connector = await this.findOwned(userId, id);
    if (!connector.revokedAt) {
      await this.connectorRepo.update(
        { id, userId, revokedAt: IsNull() },
        {
          revokedAt: new Date(),
          enrollmentTokenHash: null,
          enrollmentTokenExpiresAt: null,
        },
      );
    }
    // Always run, so a key minted while the connector was being revoked
    // can't survive (see exchangeToken).
    const keys = await this.authService.revokeConnectorKeys(id);
    this.logger.log(
      `Connector ${id} revoked by user ${userId}; ${keys} live key(s) revoked`,
    );
  }

  private async findOwned(userId: string, id: string): Promise<Connector> {
    const connector = await this.connectorRepo.findOne({
      where: { id, userId },
    });
    if (!connector) {
      throw new NotFoundException(`Connector #${id} not found`);
    }
    return connector;
  }

  // --- Connector (connector-issued key) ---------------------------------------

  /**
   * Stores the config summary a connector shares, replacing the previous
   * one, and counts as contact from it. The connector builds the summary
   * from an allowlist of safe settings; the DTO has already checked every
   * field. Certificates outside the connector's restrictions are stored
   * too: the dashboard points them out.
   */
  async storeConfig(
    user: KeyUser & { userId: string },
    dto: ConnectorConfigDto,
  ): Promise<void> {
    const connectorId = requireConnectorKey(user);
    const summary = toConfigSummary(dto);
    const now = new Date();
    const result = await this.connectorRepo.update(
      { id: connectorId, userId: user.userId, revokedAt: IsNull() },
      {
        configSummary: summary,
        configHash: summary.hash,
        configReportedAt: now,
        lastSeenAt: now,
        staleAlertedAt: null,
      },
    );
    if (!result.affected) {
      throw new ForbiddenException('This connector has been revoked.');
    }
  }

  /**
   * Clears the stored config summary, for a connector that turned sharing
   * off. Succeeds when nothing was stored.
   */
  async clearConfig(user: KeyUser & { userId: string }): Promise<void> {
    const connectorId = requireConnectorKey(user);
    const result = await this.connectorRepo.update(
      { id: connectorId, userId: user.userId, revokedAt: IsNull() },
      {
        configSummary: null,
        configHash: null,
        configReportedAt: null,
        lastSeenAt: new Date(),
        staleAlertedAt: null,
      },
    );
    if (!result.affected) {
      throw new ForbiddenException('This connector has been revoked.');
    }
  }

  // --- Connector (unauthenticated) -------------------------------------------

  /**
   * Enrolls a connector: consumes its token and stores its public key. The
   * token is consumed by a single conditional UPDATE, so two requests with
   * the same token can't both succeed.
   */
  async enroll(
    dto: ConnectorEnrollDto,
    ip?: string,
  ): Promise<ConnectorEnrollResponse> {
    if (!parsePublicKey(dto.publicKey)) {
      throw new BadRequestException(
        'publicKey is not a valid Ed25519 public key',
      );
    }
    // Every token, well-formed or not, gets the same HMAC and the same
    // conditional UPDATE, so a refusal takes the same work whatever the
    // reason.
    const now = new Date();
    const result = await this.connectorRepo
      .createQueryBuilder()
      .update(Connector)
      .set({
        enrollmentTokenHash: null,
        enrollmentTokenExpiresAt: null,
        publicKey: dto.publicKey,
        enrolledAt: now,
        lastSeenAt: now,
        staleAlertedAt: null,
        version: dto.version,
        os: dto.os,
        arch: dto.arch,
      })
      .where('"enrollmentTokenHash" = :hash', {
        hash: this.authService.hmacSecret(dto.token),
      })
      .andWhere('"enrollmentTokenExpiresAt" > :now', { now })
      .andWhere('"enrolledAt" IS NULL')
      .andWhere('"revokedAt" IS NULL')
      .returning(['id', 'name', 'userId'])
      .execute();

    const row = (
      result.raw as { id: string; name: string; userId: string }[]
    )[0];
    if (!row) {
      this.refuseEnrollment(
        'unknown, malformed, used, expired or revoked token',
        ip,
      );
    }
    this.logger.log(
      `Connector ${row.id} (user ${row.userId}) enrolled${ip ? ` from ${ip}` : ''}`,
    );
    return { connectorId: row.id, name: row.name };
  }

  private refuseEnrollment(reason: string, ip?: string): never {
    this.logger.warn(
      `Connector enrollment refused${ip ? ` from ${ip}` : ''}: ${reason}`,
    );
    throw new UnauthorizedException(INVALID_ENROLLMENT_TOKEN);
  }

  /** Exchanges a signed request for a short-lived API key. */
  async exchangeToken(
    dto: ConnectorTokenDto,
    ip?: string,
  ): Promise<ConnectorTokenResponse> {
    const connector = await this.authenticate(
      dto,
      tokenMessage(dto.connectorId, dto.timestamp, dto.nonce),
      ip,
    );

    const key = await this.authService.createEphemeralApiKey(
      connector.userId,
      `Connector: ${connector.name}`,
      CONNECTOR_KEY_SOURCE,
      CONNECTOR_KEY_TTL_SECONDS,
      {
        scopes: connector.scopes,
        allowedDomainIds: connector.allowedDomainIds,
        allowedCertIds: connector.allowedCertIds,
      },
      { connectorId: connector.id },
    );

    // A revocation that ran between authenticate() and the insert above
    // would have missed this key; look again and revoke it if so.
    const after = await this.connectorRepo.findOne({
      where: { id: connector.id },
      select: ['id', 'revokedAt'],
    });
    if (!after || after.revokedAt) {
      await this.authService.revokeConnectorKeys(connector.id);
      this.refuseCredentials(connector.id, 'revoked during exchange', ip);
    }

    await this.markSeen(connector.id);
    this.logger.log(
      `Connector ${connector.id} (user ${connector.userId}) got key ${key.id}${ip ? ` from ${ip}` : ''}`,
    );
    return { apiKey: key.apiKey, expiresAt: key.expiresAt.toISOString() };
  }

  /**
   * Replaces the connector's public key, signed by the current one, and
   * revokes every key issued so far. Rotating is what a connector does
   * after a suspected compromise of its host, so keys minted under the old
   * key must not outlive it; the connector gets a fresh one with the new
   * key right after.
   */
  async rotate(dto: ConnectorRotateDto, ip?: string): Promise<void> {
    if (!parsePublicKey(dto.newPublicKey)) {
      throw new BadRequestException(
        'newPublicKey is not a valid Ed25519 public key',
      );
    }
    const connector = await this.authenticate(
      dto,
      rotateMessage(
        dto.connectorId,
        dto.newPublicKey,
        dto.timestamp,
        dto.nonce,
      ),
      ip,
    );
    // Checked after the signature, so only the connector learns this
    if (dto.newPublicKey === connector.publicKey) {
      throw new BadRequestException(
        'newPublicKey must differ from the current key',
      );
    }
    const result = await this.connectorRepo.update(
      {
        id: connector.id,
        publicKey: connector.publicKey!,
        revokedAt: IsNull(),
      },
      {
        publicKey: dto.newPublicKey,
        lastSeenAt: new Date(),
        staleAlertedAt: null,
      },
    );
    if (!result.affected) {
      this.refuseCredentials(connector.id, 'key changed or revoked', ip);
    }
    const keys = await this.authService.revokeConnectorKeys(connector.id);
    this.logger.log(
      `Connector ${connector.id} rotated its key${ip ? ` from ${ip}` : ''}; ${keys} live key(s) revoked`,
    );
  }

  /**
   * Checks a signed request: the connector exists, is enrolled and not
   * revoked, the timestamp is within CONNECTOR_MAX_CLOCK_SKEW_SECONDS, the
   * signature is valid for its current key, and the nonce is new. Every
   * failure is the same 401.
   */
  private async authenticate(
    dto: {
      connectorId: string;
      timestamp: string;
      nonce: string;
      signature: string;
    },
    message: string,
    ip?: string,
  ): Promise<Connector> {
    const connector = await this.connectorRepo.findOne({
      where: { id: dto.connectorId },
    });
    if (!connector) {
      this.refuseCredentials(dto.connectorId, 'unknown connector', ip);
    }
    if (connector.revokedAt) {
      this.refuseCredentials(connector.id, 'revoked', ip);
    }
    if (!connector.enrolledAt || !connector.publicKey) {
      this.refuseCredentials(connector.id, 'not enrolled', ip);
    }

    const ts = parseTimestamp(dto.timestamp);
    if (
      ts === null ||
      Math.abs(Date.now() - ts) > CONNECTOR_MAX_CLOCK_SKEW_SECONDS * 1000
    ) {
      this.refuseCredentials(
        connector.id,
        'timestamp outside the allowed window',
        ip,
      );
    }

    const publicKey = parsePublicKey(connector.publicKey);
    if (!publicKey || !verifySignature(publicKey, message, dto.signature)) {
      this.refuseCredentials(connector.id, 'bad signature', ip);
    }

    // Only after the signature, so nobody else can use up a nonce
    if (!(await this.nonces.claim(connector.id, dto.nonce))) {
      this.refuseCredentials(connector.id, 'nonce reused', ip);
    }
    return connector;
  }

  private refuseCredentials(
    connectorId: string,
    reason: string,
    ip?: string,
  ): never {
    this.logger.warn(
      `Connector ${connectorId} refused${ip ? ` from ${ip}` : ''}: ${reason}`,
    );
    throw new UnauthorizedException(INVALID_CONNECTOR_CREDENTIALS);
  }

  /** Records contact from a connector and re-arms its stale alert. */
  private async markSeen(id: string): Promise<void> {
    await this.connectorRepo.update(id, {
      lastSeenAt: new Date(),
      staleAlertedAt: null,
    });
  }
}

/** The connector a request's key was issued to; 403 for any other caller. */
function requireConnectorKey(user: KeyUser): string {
  const connectorId = user.apiKey?.connectorId;
  if (!connectorId) {
    throw new ForbiddenException(
      'Only a key issued to a connector can share its config.',
    );
  }
  return connectorId;
}

/**
 * The summary as stored: built field by field from the validated DTO, so
 * nothing but the fields below is kept, with optional fields filled in.
 */
export function toConfigSummary(
  dto: ConnectorConfigDto,
): ConnectorConfigSummary {
  return {
    hash: dto.hash,
    version: dto.version,
    checkIntervalSeconds: dto.checkIntervalSeconds ?? null,
    plugins: dto.plugins.map((p) => ({
      name: p.name,
      version: p.version ?? null,
      source: p.source,
    })),
    certificates: dto.certificates.map((c) => ({
      certificateId: c.certificateId,
      names: [...c.names],
      keyStore: {
        plugin: c.keyStore.plugin,
        keyType: c.keyStore.keyType ?? null,
        settings: { ...(c.keyStore.settings ?? {}) },
      },
      targets: c.targets.map((t) => ({
        label: t.label,
        plugin: t.plugin,
        implicit: t.implicit,
        runsCommand: t.runsCommand,
        verify: t.verify
          ? {
              host: t.verify.host ?? null,
              port: t.verify.port ?? null,
              skipChainValidation: t.verify.skipChainValidation,
            }
          : null,
        settings: { ...(t.settings ?? {}) },
      })),
    })),
    truncated: dto.truncated ?? false,
  };
}

/** Same members, ignoring order; null and [] both mean "none". */
function sameSet<T>(a: T[] | null, b: T[] | null): boolean {
  const x = new Set(a ?? []);
  const y = new Set(b ?? []);
  return x.size === y.size && [...x].every((v) => y.has(v));
}

function tokenExpiry(): Date {
  return new Date(Date.now() + CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS * 1000);
}

export function toDto(c: Connector): ConnectorDto {
  return {
    id: c.id,
    name: c.name,
    clientLabel: c.clientLabel,
    scopes: c.scopes as ConnectorScope[],
    allowedCertIds: c.allowedCertIds,
    allowedDomainIds: c.allowedDomainIds,
    enrolledAt: c.enrolledAt ? c.enrolledAt.toISOString() : null,
    enrollmentTokenExpiresAt:
      !c.enrolledAt && !c.revokedAt && c.enrollmentTokenExpiresAt
        ? c.enrollmentTokenExpiresAt.toISOString()
        : null,
    revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
    lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
    version: c.version,
    os: c.os,
    arch: c.arch,
    createdAt: c.createdAt.toISOString(),
  };
}
