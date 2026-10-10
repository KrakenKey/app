import {
  BadRequestException,
  ConflictException,
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
  CONNECTOR_ENROLMENT_TOKEN_PREFIX,
  CONNECTOR_ENROLMENT_TOKEN_TTL_SECONDS,
  CONNECTOR_KEY_TTL_SECONDS,
  CONNECTOR_MAX_CLOCK_SKEW_SECONDS,
  MAX_CONNECTORS_PER_USER,
  type Connector as ConnectorDto,
  type ConnectorEnrolResponse,
  type ConnectorEnrolmentTokenResponse,
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
  ConnectorEnrolDto,
  ConnectorRotateDto,
  ConnectorTokenDto,
  CreateConnectorDto,
  UpdateConnectorDto,
} from './dto/connector.dto';

/** Every enrolment failure gets this, so a caller learns nothing about why. */
export const INVALID_ENROLMENT_TOKEN = 'Invalid enrolment token';
/** Every token or rotate failure gets this. */
export const INVALID_CONNECTOR_CREDENTIALS = 'Invalid connector credentials';

/** Source recorded on keys issued to connectors. */
export const CONNECTOR_KEY_SOURCE = 'connector';

/** kkce_ + base64url of 32 random bytes. */
function newEnrolmentToken(): string {
  return `${CONNECTOR_ENROLMENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
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

  async get(userId: string, id: string): Promise<ConnectorDto> {
    return toDto(await this.findOwned(userId, id));
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

    const enrolmentToken = newEnrolmentToken();
    const connector = this.connectorRepo.create({
      userId,
      name: dto.name,
      clientLabel: dto.clientLabel ?? null,
      scopes,
      allowedCertIds: limits.allowedCertIds,
      allowedDomainIds: limits.allowedDomainIds,
      publicKey: null,
      enrolmentTokenHash: this.authService.hashSecret(enrolmentToken),
      enrolmentTokenExpiresAt: tokenExpiry(),
      enrolledAt: null,
      revokedAt: null,
      lastSeenAt: null,
      staleAlertedAt: null,
      version: null,
      os: null,
      arch: null,
    });
    await this.connectorRepo.save(connector);
    this.logger.log(`Connector ${connector.id} created by user ${userId}`);
    return { connector: toDto(connector), enrolmentToken };
  }

  /**
   * Replaces the enrolment token of a connector that has not enrolled yet.
   * The previous token, used or not, stops working.
   */
  async reissueEnrolmentToken(
    userId: string,
    id: string,
  ): Promise<ConnectorEnrolmentTokenResponse> {
    const connector = await this.findOwned(userId, id);
    if (connector.revokedAt) {
      throw new ConflictException('This connector has been revoked');
    }
    if (connector.enrolledAt) {
      throw new ConflictException('This connector has already enrolled');
    }
    const enrolmentToken = newEnrolmentToken();
    const result = await this.connectorRepo.update(
      { id, userId, enrolledAt: IsNull(), revokedAt: IsNull() },
      {
        enrolmentTokenHash: this.authService.hashSecret(enrolmentToken),
        enrolmentTokenExpiresAt: tokenExpiry(),
      },
    );
    if (!result.affected) {
      // Enrolled or revoked since the read above
      throw new ConflictException('This connector has already enrolled');
    }
    return { enrolmentToken };
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateConnectorDto,
  ): Promise<ConnectorDto> {
    const connector = await this.findOwned(userId, id);
    const changes: { name?: string; clientLabel?: string | null } = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.clientLabel !== undefined) changes.clientLabel = dto.clientLabel;
    if (Object.keys(changes).length) {
      await this.connectorRepo.update({ id, userId }, changes);
      Object.assign(connector, changes);
    }
    return toDto(connector);
  }

  /**
   * Revokes a connector: it can't enrol, get keys or rotate any more, and
   * every key it was issued stops working. Revoking twice is a no-op.
   */
  async revoke(userId: string, id: string): Promise<void> {
    const connector = await this.findOwned(userId, id);
    if (!connector.revokedAt) {
      await this.connectorRepo.update(
        { id, userId, revokedAt: IsNull() },
        {
          revokedAt: new Date(),
          enrolmentTokenHash: null,
          enrolmentTokenExpiresAt: null,
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

  // --- Connector (unauthenticated) -------------------------------------------

  /**
   * Enrols a connector: consumes its token and stores its public key. The
   * token is consumed by a single conditional UPDATE, so two requests with
   * the same token can't both succeed.
   */
  async enrol(
    dto: ConnectorEnrolDto,
    ip?: string,
  ): Promise<ConnectorEnrolResponse> {
    if (!parsePublicKey(dto.publicKey)) {
      throw new BadRequestException(
        'publicKey is not a valid Ed25519 public key',
      );
    }
    if (
      !dto.token.startsWith(CONNECTOR_ENROLMENT_TOKEN_PREFIX) ||
      dto.token.length < CONNECTOR_ENROLMENT_TOKEN_PREFIX.length + 43
    ) {
      this.refuseEnrolment('malformed token', ip);
    }

    const now = new Date();
    const result = await this.connectorRepo
      .createQueryBuilder()
      .update(Connector)
      .set({
        enrolmentTokenHash: null,
        enrolmentTokenExpiresAt: null,
        publicKey: dto.publicKey,
        enrolledAt: now,
        lastSeenAt: now,
        staleAlertedAt: null,
        version: dto.version,
        os: dto.os,
        arch: dto.arch,
      })
      .where('"enrolmentTokenHash" = :hash', {
        hash: this.authService.hashSecret(dto.token),
      })
      .andWhere('"enrolmentTokenExpiresAt" > :now', { now })
      .andWhere('"enrolledAt" IS NULL')
      .andWhere('"revokedAt" IS NULL')
      .returning(['id', 'name', 'userId'])
      .execute();

    const row = (
      result.raw as { id: string; name: string; userId: string }[]
    )[0];
    if (!row) {
      this.refuseEnrolment('unknown, used, expired or revoked token', ip);
    }
    this.logger.log(
      `Connector ${row.id} (user ${row.userId}) enrolled${ip ? ` from ${ip}` : ''}`,
    );
    return { connectorId: row.id, name: row.name };
  }

  private refuseEnrolment(reason: string, ip?: string): never {
    this.logger.warn(
      `Connector enrolment refused${ip ? ` from ${ip}` : ''}: ${reason}`,
    );
    throw new UnauthorizedException(INVALID_ENROLMENT_TOKEN);
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

  /** Replaces the connector's public key, signed by the current one. */
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
    this.logger.log(
      `Connector ${connector.id} rotated its key${ip ? ` from ${ip}` : ''}`,
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

function tokenExpiry(): Date {
  return new Date(Date.now() + CONNECTOR_ENROLMENT_TOKEN_TTL_SECONDS * 1000);
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
    revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
    lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
    version: c.version,
    os: c.os,
    arch: c.arch,
    createdAt: c.createdAt.toISOString(),
  };
}
