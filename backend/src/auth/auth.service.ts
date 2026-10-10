import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  InternalServerErrorException,
  UnauthorizedException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { In, IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { UserApiKey } from './entities/user-api-key.entity';
import { ServiceApiKey } from './entities/service-api-key.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { scryptSync, randomBytes } from 'crypto';
import { User } from '../users/entities/user.entity';
import { Domain } from '../domains/entities/domain.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { BillingService } from '../billing/billing.service';
import { PLAN_LIMITS } from '../billing/constants/plan-limits';
import { EmailService } from '../notifications/email.service';
import { ApiKeySecurityService } from './services/api-key-security.service';
import { ipAllowed, parseIpEntry } from './api-key-restrictions';
import type {
  ApiKey,
  ApiKeyScope,
  AuthCallbackResponse,
  CreateApiKeyResponse,
  LogoutUrlResponse,
  SubscriptionPlan,
  UserProfile,
} from '@krakenkey/shared';

/** Restrictions chosen when a key is created; all optional, all fixed. */
export interface ApiKeyRestrictions {
  scopes?: ApiKeyScope[];
  allowedDomainIds?: string[];
  allowedCertIds?: number[];
  allowedIps?: string[];
}

/** Revoked keys stay listed (and in the table) this long before the purge. */
export const REVOKED_KEY_RETENTION_DAYS = 30;
const LAST_USED_RESOLUTION_MS = 60_000;

function revokedKeyCutoff(): Date {
  return new Date(
    Date.now() - REVOKED_KEY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(UserApiKey)
    private userApiKeyRepo: Repository<UserApiKey>,
    @InjectRepository(ServiceApiKey)
    private serviceApiKeyRepo: Repository<ServiceApiKey>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Domain)
    private readonly domainRepo: Repository<Domain>,
    @InjectRepository(TlsCrt)
    private readonly tlsCrtRepo: Repository<TlsCrt>,
    private readonly billingService: BillingService,
    private readonly emailService: EmailService,
    private readonly apiKeySecurity: ApiKeySecurityService,
  ) {}

  async onModuleInit() {
    const secret = this.config.get<string>('KK_HMAC_SECRET');
    if (!secret) {
      this.logger.error(
        'KK_HMAC_SECRET is not set — API key creation and validation will fail. ' +
          'Add the secret to your environment before using key-based auth.',
      );
    }
    await this.seedServiceKey();
  }

  /**
   * scrypt key hashing with a server-side secret as salt.
   * Prevents offline key verification if the DB is compromised without the secret.
   */
  private hashKey(raw: string): string {
    const secret = this.config.get<string>('KK_HMAC_SECRET');
    if (!secret) {
      throw new Error(
        'KK_HMAC_SECRET must be set to use key-based authentication',
      );
    }
    return scryptSync(raw, secret, 64).toString('hex');
  }

  /**
   * Hashes a secret other than an API key (such as a connector enrolment
   * token) the same way API keys are hashed, for storage and lookup.
   */
  hashSecret(raw: string): string {
    return this.hashKey(raw);
  }

  /**
   * Seeds a service key from KK_PROBE_API_KEY env var on startup.
   * Idempotent: skips if the hash already exists.
   */
  private async seedServiceKey() {
    const rawKey = this.config.get<string>('KK_PROBE_API_KEY');
    if (!rawKey) return;

    const secret = this.config.get<string>('KK_HMAC_SECRET');
    if (!secret) {
      this.logger.warn('Skipping service key seed — KK_HMAC_SECRET is not set');
      return;
    }

    const hash = this.hashKey(rawKey);
    const existing = await this.serviceApiKeyRepo.findOne({ where: { hash } });
    if (existing) return;

    const key = this.serviceApiKeyRepo.create({
      name: 'probe-service-key',
      hash,
    });
    await this.serviceApiKeyRepo.save(key);
    this.logger.log('Service key seeded from KK_PROBE_SERVICE_KEY');
  }

  // --- Authentik OIDC Redirects ---

  /**
   * Generates redirect URL for registration flow.
   *
   * Sends user to Authentik enrollment, then OAuth authorization, then back to app.
   * The 'next' parameter chains enrollment -> OAuth -> callback automatically.
   */
  getRegisterRedirect() {
    const domain = this.config.get<string>('KK_AUTHENTIK_DOMAIN');
    const enrollmentSlug = this.config.get<string>(
      'KK_AUTHENTIK_ENROLLMENT_SLUG',
    );
    const clientId = this.config.get<string>(
      'KK_AUTHENTIK_CLIENT_ID',
    ) as string;
    const redirectUri = this.config.get<string>(
      'KK_AUTHENTIK_REDIRECT_URI',
    ) as string;

    const state = randomBytes(32).toString('hex');

    // Build OAuth authorization URL
    const oauthAuthUrl = new URL(`https://${domain}/application/o/authorize/`);
    oauthAuthUrl.searchParams.set('client_id', clientId);
    oauthAuthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthAuthUrl.searchParams.set('response_type', 'code');
    oauthAuthUrl.searchParams.set('scope', 'openid email profile');
    oauthAuthUrl.searchParams.set('state', state);

    // Use relative path for 'next' to avoid open redirect issues
    const nextTarget = encodeURIComponent(
      oauthAuthUrl.pathname + oauthAuthUrl.search,
    );
    const url = `https://${domain}/if/flow/${enrollmentSlug}/?next=${nextTarget}`;

    return { url, state, statusCode: 302 };
  }

  /**
   * Generates redirect URL for standard OIDC login flow.
   */
  getLoginRedirect() {
    const domain = this.config.get<string>('KK_AUTHENTIK_DOMAIN');
    const clientId = this.config.get<string>(
      'KK_AUTHENTIK_CLIENT_ID',
    ) as string;
    const redirectUri = this.config.get<string>(
      'KK_AUTHENTIK_REDIRECT_URI',
    ) as string;

    const state = randomBytes(32).toString('hex');

    const url = new URL(`https://${domain}/application/o/authorize/`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);

    return { url: url.toString(), state, statusCode: 302 };
  }

  /**
   * Returns the Authentik end-session endpoint for OIDC RP-initiated logout,
   * plus the app origin to come back to afterwards.
   *
   * The browser adds id_token_hint itself and goes to Authentik directly, so
   * the ID token never passes through this API. postLogoutRedirectUri must be
   * registered as a logout redirect URI on the Authentik provider, otherwise
   * Authentik rejects the request.
   */
  getLogoutUrl(): LogoutUrlResponse {
    const issuerUrl = this.config.get<string>('KK_AUTHENTIK_ISSUER_URL');
    const redirectUri = this.config.get<string>('KK_AUTHENTIK_REDIRECT_URI');

    if (!issuerUrl || !redirectUri) {
      this.logger.error(
        'KK_AUTHENTIK_ISSUER_URL and KK_AUTHENTIK_REDIRECT_URI must be set to build the logout URL',
      );
      throw new InternalServerErrorException('Logout is not configured');
    }

    try {
      const base = issuerUrl.endsWith('/') ? issuerUrl : `${issuerUrl}/`;
      const url = new URL('end-session/', base).toString();
      const postLogoutRedirectUri = new URL(redirectUri).origin;
      return { url, postLogoutRedirectUri };
    } catch {
      this.logger.error(
        'KK_AUTHENTIK_ISSUER_URL or KK_AUTHENTIK_REDIRECT_URI is not a valid URL',
      );
      throw new InternalServerErrorException('Logout is not configured');
    }
  }

  /**
   * Handles OIDC callback from Authentik.
   *
   * Flow:
   * 1. Exchange authorization code for tokens (access_token, id_token)
   * 2. Decode id_token to extract user profile (sub, email, username, groups)
   * 3. Create user in DB if they don't exist (Just-In-Time provisioning)
   * 4. Return tokens to frontend
   *
   * The 'sub' claim from id_token is used as the primary key in our User table,
   * linking our local user records to Authentik identities.
   */
  async handleCallback(
    code: string,
    state: string,
    cookieState: string | undefined,
  ): Promise<AuthCallbackResponse> {
    if (!cookieState || !state || cookieState !== state) {
      throw new UnauthorizedException(
        'OAuth state mismatch. Please try logging in again.',
      );
    }

    const domain = this.config.get<string>('KK_AUTHENTIK_DOMAIN');
    const clientId = this.config.get<string>('KK_AUTHENTIK_CLIENT_ID');
    const clientSecret = this.config.get<string>('KK_AUTHENTIK_CLIENT_SECRET');
    const redirectUri = this.config.get<string>('KK_AUTHENTIK_REDIRECT_URI');

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('client_id', clientId!);
    params.append('client_secret', clientSecret!);
    params.append('redirect_uri', redirectUri!);

    // Server-to-server token exchange (not exposed to frontend)
    const response = await fetch(`https://${domain}/application/o/token/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to exchange code for token: ${errorText}`);
    }

    const data = (await response.json()) as AuthCallbackResponse;
    Logger.log('AuthService: token exchange successful');

    if (data.id_token) {
      Logger.log('AuthService: ID token received and verified');
    }

    // Just-In-Time user provisioning: extract user info from id_token and create if needed
    if (data.id_token) {
      const payload = JSON.parse(
        Buffer.from(data.id_token.split('.')[1], 'base64').toString(),
      ) as {
        sub: string;
        preferred_username: string;
        email: string;
        groups?: string[];
      };

      await this.ensureUserExists({
        sub: payload.sub,
        preferred_username: payload.preferred_username,
        email: payload.email,
        groups: payload.groups || [],
      });
    }
    return data;
  }

  // --- API Key Management ---
  /**
   * Creates a new API key for a user.
   *
   * Keys are prefixed with 'kk_' and hashed (scrypt) before storage.
   * The raw key is returned only once - it cannot be retrieved later.
   */
  async createApiKey(
    userId: string,
    name: string,
    expiresAt?: string,
    restrictions: ApiKeyRestrictions = {},
  ) {
    const limits = await this.validateRestrictions(userId, restrictions);
    await this.assertApiKeyLimit(userId);

    const rawKey = `kk_${randomBytes(24).toString('hex')}`;
    const hash = this.hashKey(rawKey);

    const apiKey = this.userApiKeyRepo.create({
      name,
      hash,
      user: { id: userId },
      ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
      ...limits,
    });
    await this.userApiKeyRepo.save(apiKey);

    const response: CreateApiKeyResponse = {
      apiKey: rawKey,
      id: apiKey.id,
      name: apiKey.name,
      ...limits,
    };
    return response;
  }

  /**
   * Checks the restrictions for a new key and returns them normalised, with
   * null for "unrestricted". Domain and certificate ids must belong to the
   * user or their organization, so a key can never point at someone else's
   * resources (restrictions only narrow access, but a foreign id would
   * still leak whether it exists).
   */
  async validateRestrictions(
    userId: string,
    r: ApiKeyRestrictions,
  ): Promise<{
    scopes: ApiKeyScope[] | null;
    allowedDomainIds: string[] | null;
    allowedCertIds: number[] | null;
    allowedIps: string[] | null;
  }> {
    const scopes = r.scopes ? [...new Set(r.scopes)] : null;
    const allowedDomainIds = r.allowedDomainIds?.length
      ? [...new Set(r.allowedDomainIds)]
      : null;
    const allowedCertIds = r.allowedCertIds?.length
      ? [...new Set(r.allowedCertIds)]
      : null;

    let allowedIps: string[] | null = null;
    if (r.allowedIps?.length) {
      const bad = r.allowedIps.filter((e) => !parseIpEntry(e));
      if (bad.length) {
        throw new BadRequestException(
          `Invalid IP address or CIDR range: ${bad.join(', ')}`,
        );
      }
      allowedIps = [...new Set(r.allowedIps.map((e) => e.trim()))];
    }

    if (allowedDomainIds || allowedCertIds) {
      const memberIds =
        await this.billingService.getResourceCountUserIds(userId);
      if (allowedDomainIds) {
        const found = await this.domainRepo.find({
          where: { id: In(allowedDomainIds), userId: In(memberIds) },
          select: ['id'],
        });
        const known = new Set(found.map((d) => d.id));
        const missing = allowedDomainIds.filter((id) => !known.has(id));
        if (missing.length) {
          throw new BadRequestException(
            `Unknown domain id(s): ${missing.join(', ')}`,
          );
        }
      }
      if (allowedCertIds) {
        const found = await this.tlsCrtRepo.find({
          where: { id: In(allowedCertIds), userId: In(memberIds) },
          select: ['id'],
        });
        const known = new Set(found.map((c) => c.id));
        const missing = allowedCertIds.filter((id) => !known.has(id));
        if (missing.length) {
          throw new BadRequestException(
            `Unknown certificate id(s): ${missing.join(', ')}`,
          );
        }
      }
    }

    return { scopes, allowedDomainIds, allowedCertIds, allowedIps };
  }

  /**
   * Throws 402 when the user's plan has no API key slots left (pooled across
   * org members). Device login calls this at approval so the dashboard can
   * show the error, before the key is created.
   */
  async assertApiKeyLimit(userId: string): Promise<void> {
    const plan = (await this.billingService.resolveUserTier(
      userId,
    )) as SubscriptionPlan;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    if (limits.apiKeys !== Infinity) {
      const memberIds =
        await this.billingService.getResourceCountUserIds(userId);
      // Short-lived keys (GitHub OIDC, connectors) don't take a plan slot
      const count = await this.userApiKeyRepo.count({
        where: { userId: In(memberIds), revokedAt: IsNull(), source: IsNull() },
      });
      if (count >= limits.apiKeys) {
        throw new HttpException(
          {
            message: 'API key limit reached',
            limit: limits.apiKeys,
            current: count,
            plan,
          },
          402,
        );
      }
    }
  }

  /**
   * Returns a user's API keys (metadata only, no secrets). Revoked keys are
   * left out unless includeRevoked, which adds those revoked in the last
   * REVOKED_KEY_RETENTION_DAYS.
   */
  async listApiKeys(
    userId: string,
    opts: { includeRevoked?: boolean } = {},
  ): Promise<ApiKey[]> {
    // Short-lived keys are left out; the GitHub trust policy or connector
    // they were issued to shows when it was last used.
    const where = opts.includeRevoked
      ? [
          { userId, revokedAt: IsNull(), source: IsNull() },
          {
            userId,
            revokedAt: MoreThan(revokedKeyCutoff()),
            source: IsNull(),
          },
        ]
      : { userId, revokedAt: IsNull(), source: IsNull() };
    const keys = await this.userApiKeyRepo.find({
      where,
      order: { createdAt: 'DESC' },
      select: [
        'id',
        'name',
        'createdAt',
        'expiresAt',
        'revokedAt',
        'lastUsedAt',
        'lastUsedIp',
        'scopes',
        'allowedDomainIds',
        'allowedCertIds',
        'allowedIps',
      ],
    });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      createdAt: k.createdAt.toISOString(),
      expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
      revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
      lastUsedIp: k.lastUsedIp ?? null,
      scopes: k.scopes ?? null,
      allowedDomainIds: k.allowedDomainIds ?? null,
      allowedCertIds: k.allowedCertIds ?? null,
      allowedIps: k.allowedIps ?? null,
    }));
  }

  /**
   * Revokes an API key owned by the specified user. The row is kept so the
   * dashboard can show when it was revoked and last used; the daily purge
   * removes it later. Throws NotFoundException if the key doesn't exist,
   * isn't owned by the user, or is already revoked.
   */
  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    const result = await this.userApiKeyRepo.update(
      { id: keyId, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (result.affected === 0) {
      throw new NotFoundException(`API key #${keyId} not found`);
    }
  }

  /**
   * Creates a short-lived key for a machine exchange such as GitHub OIDC or
   * a connector. It isn't listed, doesn't count toward the plan's key
   * limit, and expires after ttlSeconds. Restrictions must already be
   * validated. A key issued to a connector records its connectorId.
   */
  async createEphemeralApiKey(
    userId: string,
    name: string,
    source: string,
    ttlSeconds: number,
    restrictions: {
      scopes: ApiKeyScope[] | null;
      allowedDomainIds: string[] | null;
      allowedCertIds: number[] | null;
    },
    options: { connectorId?: string } = {},
  ): Promise<{ id: string; apiKey: string; expiresAt: Date }> {
    const rawKey = `kk_${randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const key = this.userApiKeyRepo.create({
      name: name.slice(0, 100),
      hash: this.hashKey(rawKey),
      user: { id: userId },
      expiresAt,
      source,
      scopes: restrictions.scopes,
      allowedDomainIds: restrictions.allowedDomainIds,
      allowedCertIds: restrictions.allowedCertIds,
      allowedIps: null,
      connectorId: options.connectorId ?? null,
    });
    await this.userApiKeyRepo.save(key);
    return { id: key.id, apiKey: rawKey, expiresAt };
  }

  /**
   * Revokes every live key issued to a connector. Returns how many were
   * revoked.
   */
  async revokeConnectorKeys(connectorId: string): Promise<number> {
    const result = await this.userApiKeyRepo.update(
      { connectorId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return result.affected ?? 0;
  }

  /** Hourly: delete short-lived keys that expired more than an hour ago. */
  @Cron('15 * * * *')
  async purgeExpiredEphemeralKeys(): Promise<void> {
    const result = await this.userApiKeyRepo.delete({
      source: Not(IsNull()),
      expiresAt: LessThan(new Date(Date.now() - 3600_000)),
    });
    if (result.affected) {
      this.logger.log(`Purged ${result.affected} expired short-lived key(s)`);
    }
  }

  /** Daily: delete keys revoked more than REVOKED_KEY_RETENTION_DAYS ago. */
  @Cron('30 4 * * *')
  async purgeRevokedApiKeys(): Promise<void> {
    const result = await this.userApiKeyRepo.delete({
      revokedAt: LessThan(revokedKeyCutoff()),
    });
    if (result.affected) {
      this.logger.log(`Purged ${result.affected} revoked API key(s)`);
    }
  }

  /**
   * Validates an API key by hashing and looking up in the database.
   *
   * Returns the UserApiKey record with user relation if valid, null otherwise.
   * Use of a correct-but-expired key triggers an owner notification (the only
   * failure mode attributable to a specific key), rate-limited per key.
   */
  async validateApiKey(rawKey: string, meta?: { ip?: string }) {
    const hash = this.hashKey(rawKey);
    const record = await this.userApiKeyRepo.findOne({
      where: { hash },
      relations: ['user'],
    });
    if (!record) return null;
    if (record.revokedAt) {
      this.logger.warn(
        `Revoked API key ${record.id} presented${meta?.ip ? ` from ${meta.ip}` : ''}`,
      );
      return null;
    }
    if (record.expiresAt && record.expiresAt < new Date()) {
      // Short-lived machine keys expire by design; don't email about them
      if (!record.source) await this.notifyExpiredKeyUse(record, meta?.ip);
      return null;
    }
    // A valid key from the wrong address: 403, not 401, and not counted
    // toward the brute-force lockout, since the key itself is correct.
    if (
      record.allowedIps?.length &&
      !ipAllowed(meta?.ip ?? '', record.allowedIps)
    ) {
      this.logger.warn(
        `API key ${record.id} refused from ${meta?.ip || 'unknown address'}: not in its IP allowlist`,
      );
      throw new ForbiddenException(
        'This API key cannot be used from this IP address.',
      );
    }
    await this.recordKeyUse(record, meta?.ip);
    return record;
  }

  /**
   * Looks up the owner of a user API key without any side effects: no
   * last-used update, no expiry notification, no logging. Returns null for
   * unknown, revoked or expired keys. The IP allowlist is returned rather
   * than checked so callers can cache the result and check it per request.
   *
   * Used by the rate limiter, which runs before authentication; the auth
   * guard still makes the real decision via validateApiKey.
   */
  async findApiKeyOwner(rawKey: string): Promise<{
    userId: string;
    expiresAt: Date | null;
    allowedIps: string[] | null;
  } | null> {
    const record = await this.userApiKeyRepo.findOne({
      where: { hash: this.hashKey(rawKey) },
      select: ['id', 'userId', 'expiresAt', 'revokedAt', 'allowedIps'],
    });
    if (!record || record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;
    return {
      userId: record.userId,
      expiresAt: record.expiresAt ?? null,
      allowedIps: record.allowedIps?.length ? record.allowedIps : null,
    };
  }

  /**
   * Updates lastUsedAt/lastUsedIp, skipping the write when the key was used
   * from the same IP within the last minute. Never throws.
   */
  private async recordKeyUse(record: UserApiKey, ip?: string): Promise<void> {
    const now = new Date();
    const lastUsedIp = ip || null;
    if (
      record.lastUsedAt &&
      now.getTime() - record.lastUsedAt.getTime() < LAST_USED_RESOLUTION_MS &&
      record.lastUsedIp === lastUsedIp
    ) {
      return;
    }
    try {
      await this.userApiKeyRepo.update(record.id, {
        lastUsedAt: now,
        lastUsedIp,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record use of API key ${record.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Notifies a key owner that their expired key was presented for auth —
   * a signal the key is still deployed somewhere (or leaked). Never throws.
   */
  private async notifyExpiredKeyUse(
    record: UserApiKey,
    ip?: string,
  ): Promise<void> {
    try {
      if (!record.user) return;
      if (!(await this.apiKeySecurity.shouldNotifyExpiredKeyUse(record.id))) {
        return;
      }
      this.logger.warn(
        `Expired API key ${record.id} ("${record.name}") presented for user ${record.user.id}${ip ? ` from ${ip}` : ''}`,
      );
      await this.emailService.sendApiKeyExpiredUse({
        userId: record.user.id,
        username: record.user.username,
        email: record.user.email,
        keyId: record.id,
        keyName: record.name,
        ip,
      });
    } catch (err) {
      this.logger.error(
        'Failed to send expired-key-use notification',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  // --- Profile Management ---

  async getFullProfile(userId: string): Promise<UserProfile> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [memberIds, plan] = await Promise.all([
      this.billingService.getResourceCountUserIds(userId),
      this.billingService.resolveUserTier(userId),
    ]);
    const [domainCount, certCount, apiKeyCount] = await Promise.all([
      this.domainRepo.count({ where: { userId: In(memberIds) } }),
      this.tlsCrtRepo.count({ where: { userId: In(memberIds) } }),
      this.userApiKeyRepo.count({
        where: { userId: In(memberIds), revokedAt: IsNull(), source: IsNull() },
      }),
    ]);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      groups: user.groups,
      displayName: user.displayName,
      notificationPreferences: user.notificationPreferences,
      createdAt: user.createdAt.toISOString(),
      plan,
      autoRenewalConfirmedAt:
        user.autoRenewalConfirmedAt?.toISOString() ?? null,
      firstDomainAddedAt: user.firstDomainAddedAt?.toISOString() ?? null,
      firstCertIssuedAt: user.firstCertIssuedAt?.toISOString() ?? null,
      organizationId: user.organizationId ?? null,
      role: user.role ?? null,
      resourceCounts: {
        domains: domainCount,
        certificates: certCount,
        apiKeys: apiKeyCount,
      },
    };
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.displayName !== undefined) {
      user.displayName = dto.displayName || null;
    }

    if (dto.notificationPreferences !== undefined) {
      user.notificationPreferences = {
        ...user.notificationPreferences,
        ...dto.notificationPreferences,
      };
    }

    await this.userRepo.save(user);
    return this.getFullProfile(userId);
  }

  async confirmAutoRenewal(userId: string): Promise<{ confirmedAt: string }> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.autoRenewalConfirmedAt = new Date();
    user.autoRenewalReminderSentAt = null;
    await this.userRepo.save(user);
    return { confirmedAt: user.autoRenewalConfirmedAt.toISOString() };
  }

  private async ensureUserExists(authUser: {
    sub: string;
    preferred_username: string;
    email: string;
    groups?: string[];
  }) {
    let user = await this.userRepo.findOne({ where: { id: authUser.sub } });
    if (!user) {
      user = this.userRepo.create({
        id: authUser.sub,
        username: authUser.preferred_username,
        email: authUser.email,
        groups: authUser.groups || [],
        autoRenewalConfirmedAt: new Date(),
      });
      await this.userRepo.save(user);
      this.emailService
        .sendWelcome({
          userId: user.id,
          username: user.username,
          email: user.email,
        })
        .catch((err) => this.logger.error('Failed to send welcome email', err));
    }
    return user;
  }

  // --- Service API Key Management ---

  async validateServiceKey(rawKey: string): Promise<ServiceApiKey | null> {
    const hash = this.hashKey(rawKey);
    const record = await this.serviceApiKeyRepo.findOne({ where: { hash } });
    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;
    return record;
  }

  async createServiceKey(
    name: string,
    expiresAt?: string,
  ): Promise<{ apiKey: string; id: string; name: string }> {
    const rawKey = `kk_svc_${randomBytes(24).toString('hex')}`;
    const hash = this.hashKey(rawKey);

    const key = this.serviceApiKeyRepo.create({
      name,
      hash,
      ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
    });
    await this.serviceApiKeyRepo.save(key);

    return { apiKey: rawKey, id: key.id, name: key.name };
  }

  async revokeServiceKey(keyId: string): Promise<void> {
    const result = await this.serviceApiKeyRepo.update(keyId, {
      revokedAt: new Date(),
    });
    if (result.affected === 0) {
      throw new NotFoundException(`Service key #${keyId} not found`);
    }
  }
}
