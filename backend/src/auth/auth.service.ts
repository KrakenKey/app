import {
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { UserApiKey } from './entities/user-api-key.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { User } from '../users/entities/user.entity';
import { Domain } from '../domains/entities/domain.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { BillingService } from '../billing/billing.service';
import { PLAN_LIMITS } from '../billing/constants/plan-limits';
import type {
  ApiKey,
  AuthCallbackResponse,
  CreateApiKeyResponse,
  SubscriptionPlan,
  UserProfile,
} from '@krakenkey/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(UserApiKey)
    private userApiKeyRepo: Repository<UserApiKey>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Domain)
    private readonly domainRepo: Repository<Domain>,
    @InjectRepository(TlsCrt)
    private readonly tlsCrtRepo: Repository<TlsCrt>,
    private readonly billingService: BillingService,
  ) {}

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

    // Build OAuth authorization URL
    const oauthAuthUrl = new URL(`https://${domain}/application/o/authorize/`);
    oauthAuthUrl.searchParams.set('client_id', clientId);
    oauthAuthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthAuthUrl.searchParams.set('response_type', 'code');
    oauthAuthUrl.searchParams.set('scope', 'openid email profile');

    // Use relative path for 'next' to avoid open redirect issues
    const nextTarget = encodeURIComponent(
      oauthAuthUrl.pathname + oauthAuthUrl.search,
    );
    const url = `https://${domain}/if/flow/${enrollmentSlug}/?next=${nextTarget}`;

    return { url, statusCode: 302 };
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

    const url = new URL(`https://${domain}/application/o/authorize/`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');

    return { url: url.toString(), statusCode: 302 };
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
  async handleCallback(code: string): Promise<AuthCallbackResponse> {
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
   * Keys are prefixed with 'kk_' and hashed (SHA-256) before storage.
   * The raw key is returned only once - it cannot be retrieved later.
   */
  async createApiKey(userId: string, name: string, expiresAt?: string) {
    // Plan-based API key limit check (pooled across org members)
    const plan = (await this.billingService.resolveUserTier(
      userId,
    )) as SubscriptionPlan;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    if (limits.apiKeys !== Infinity) {
      const memberIds =
        await this.billingService.getResourceCountUserIds(userId);
      const count = await this.userApiKeyRepo.count({
        where: { userId: In(memberIds) },
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

    const rawKey = `kk_${randomBytes(24).toString('hex')}`;
    const hash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = this.userApiKeyRepo.create({
      name,
      hash,
      user: { id: userId },
      ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
    });
    await this.userApiKeyRepo.save(apiKey);

    const response: CreateApiKeyResponse = {
      apiKey: rawKey,
      id: apiKey.id,
      name: apiKey.name,
    };
    return response;
  }

  /**
   * Returns all API keys for a user (metadata only, no secrets).
   */
  async listApiKeys(userId: string): Promise<ApiKey[]> {
    const keys = await this.userApiKeyRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      select: ['id', 'name', 'createdAt', 'expiresAt'],
    });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      createdAt: k.createdAt.toISOString(),
      expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
    }));
  }

  /**
   * Deletes an API key owned by the specified user.
   * Throws NotFoundException if the key doesn't exist or isn't owned by the user.
   */
  async deleteApiKey(userId: string, keyId: string): Promise<void> {
    const result = await this.userApiKeyRepo.delete({ id: keyId, userId });
    if (result.affected === 0) {
      throw new NotFoundException(`API key #${keyId} not found`);
    }
  }

  /**
   * Validates an API key by hashing and looking up in the database.
   *
   * Returns the UserApiKey record with user relation if valid, null otherwise.
   */
  async validateApiKey(rawKey: string) {
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const record = await this.userApiKeyRepo.findOne({
      where: { hash },
      relations: ['user'],
    });
    if (!record) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;
    return record;
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
      this.userApiKeyRepo.count({ where: { userId: In(memberIds) } }),
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
    }
    return user;
  }
}
