import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHash, randomBytes, randomInt } from 'crypto';
import type {
  DeviceAuthRequestInfo,
  DeviceCodeResponse,
  DeviceTokenResponse,
} from '@krakenkey/shared';
import { AuthService } from '../auth.service';

/** RFC 8628 §6.1: consonants only, no vowels (no words), no 0/O, 1/I confusion. */
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const USER_CODE_LENGTH = 8;

type DeviceStatus = 'pending' | 'approved' | 'denied';

interface DeviceRecord {
  userCode: string;
  clientName: string;
  ip: string;
  createdAt: string;
  status: DeviceStatus;
  /** Set on approval; the key is created for this user when the CLI collects it. */
  approvedBy?: string;
}

/**
 * Device authorization for `krakenkey auth login --web`, modelled on RFC 8628.
 *
 * The CLI requests a device code and shows the user a short user code and a
 * dashboard URL. The user approves it while signed in to the dashboard, which
 * marks it approved. The CLI polls with its device code, and the poll that
 * finds it approved creates an API key for that user and returns it, once.
 *
 * State lives in Redis for the lifetime of the request (10 minutes by default)
 * and device codes are stored hashed. No API key is ever stored: approval only
 * records who approved, and the key is created inside the CLI's next poll, so
 * the raw key exists only in that response, as with POST /auth/api-keys.
 *
 * Unlike API key lockout, this fails closed: without Redis no login can start.
 */
@Injectable()
export class DeviceAuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceAuthService.name);
  private readonly redis: Redis;
  private readonly ttlSeconds: number;
  private readonly intervalSeconds: number;
  private readonly appDomain: string;
  private redisWarned = false;

  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    this.ttlSeconds = parseInt(config.get('KK_DEVICE_AUTH_TTL_SEC', '600'));
    this.intervalSeconds = parseInt(
      config.get('KK_DEVICE_AUTH_INTERVAL_SEC', '5'),
    );
    this.appDomain = config.get<string>('KK_APP_DOMAIN', 'app.krakenkey.io');

    this.redis = new Redis({
      host: config.get<string>('KK_BULLMQ_HOST', 'localhost'),
      port: parseInt(config.get('KK_BULLMQ_PORT', '6379')),
      password: config.get<string>('KK_BULLMQ_PASSWORD', '') || undefined,
      keyPrefix: 'device-auth:',
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on('error', (err) => {
      if (!this.redisWarned) {
        this.redisWarned = true;
        this.logger.warn(
          `Redis unavailable for device authorization: ${err.message}`,
        );
      }
    });
  }

  /**
   * Connect up front: with lazyConnect and no offline queue, the first
   * command would otherwise fail before the connection is ready.
   */
  async onModuleInit() {
    try {
      await this.redis.connect();
    } catch (err) {
      this.logger.warn(
        `Redis connect failed for device authorization: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  /** Starts a device login. Called by the CLI, unauthenticated. */
  async createDeviceCode(
    clientName: string | undefined,
    ip: string,
  ): Promise<DeviceCodeResponse> {
    const deviceCode = randomBytes(32).toString('base64url');
    const record: DeviceRecord = {
      userCode: '',
      clientName: clientName?.trim() || 'krakenkey CLI',
      ip,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    // Retry on the (very unlikely) chance a user code is already in use.
    for (let attempt = 0; attempt < 5; attempt++) {
      const userCode = generateUserCode();
      const claimed = await this.run(() =>
        this.redis.set(
          `user:${userCode}`,
          hashCode(deviceCode),
          'EX',
          this.ttlSeconds,
          'NX',
        ),
      );
      if (claimed !== 'OK') continue;

      record.userCode = userCode;
      await this.run(() =>
        this.redis.set(
          `code:${hashCode(deviceCode)}`,
          JSON.stringify(record),
          'EX',
          this.ttlSeconds,
        ),
      );

      const verificationUri = `https://${this.appDomain}/device`;
      return {
        deviceCode,
        userCode: formatUserCode(userCode),
        verificationUri,
        verificationUriComplete: `${verificationUri}?code=${formatUserCode(userCode)}`,
        expiresIn: this.ttlSeconds,
        interval: this.intervalSeconds,
      };
    }
    throw new ServiceUnavailableException('Could not allocate a user code');
  }

  /** Polled by the CLI with its device code. Returns the API key once. */
  async pollToken(deviceCode: string): Promise<DeviceTokenResponse> {
    const key = `code:${hashCode(deviceCode)}`;

    // One poll per interval; faster polling gets slow_down.
    const allowed = await this.run(() =>
      this.redis.set(
        `poll:${hashCode(deviceCode)}`,
        '1',
        'EX',
        this.intervalSeconds,
        'NX',
      ),
    );
    if (allowed !== 'OK') return { status: 'slow_down' };

    const raw = await this.run(() => this.redis.get(key));
    if (!raw) return { status: 'expired' };
    const record = JSON.parse(raw) as DeviceRecord;

    if (record.status === 'pending') return { status: 'pending' };
    if (record.status === 'denied') {
      await this.run(() => this.redis.del(key));
      return { status: 'denied' };
    }

    // Approved: take the record atomically so only one poll creates a key.
    const taken = await this.run(() => this.redis.getdel(key));
    if (!taken) return { status: 'expired' };
    const approved = JSON.parse(taken) as DeviceRecord;
    if (approved.status !== 'approved' || !approved.approvedBy) {
      return { status: 'expired' };
    }
    // A plan limit hit since approval surfaces here as a 402 to the CLI.
    const created = await this.authService.createApiKey(
      approved.approvedBy,
      keyName(approved.clientName),
    );
    this.logger.log(
      `Device login completed for user ${approved.approvedBy} (key ${created.id})`,
    );
    return {
      status: 'approved',
      apiKey: created.apiKey,
      id: created.id,
      name: created.name,
    };
  }

  /** What the approval page shows before the user confirms. */
  async getRequest(userCode: string): Promise<DeviceAuthRequestInfo> {
    const { record } = await this.findPending(userCode);
    return {
      userCode: formatUserCode(record.userCode),
      clientName: record.clientName,
      ip: record.ip,
      createdAt: record.createdAt,
    };
  }

  /** Approves a pending request for the signed-in user. */
  async approve(userCode: string, userId: string): Promise<{ name: string }> {
    const { key, record } = await this.findPending(userCode);

    // Guard against concurrent approvals of the same request.
    const locked = await this.run(() =>
      this.redis.set(`lock:${key}`, '1', 'EX', this.ttlSeconds, 'NX'),
    );
    if (locked !== 'OK') {
      throw new ForbiddenException('This login request is already approved');
    }

    try {
      // Fail here, on the approval page, rather than in the CLI later.
      await this.authService.assertApiKeyLimit(userId);
    } catch (err) {
      await this.run(() => this.redis.del(`lock:${key}`));
      throw err;
    }

    record.status = 'approved';
    record.approvedBy = userId;
    const stored = await this.run(() =>
      this.redis.set(key, JSON.stringify(record), 'KEEPTTL', 'XX'),
    );
    if (stored !== 'OK') {
      throw new NotFoundException('Login request expired');
    }
    await this.run(() => this.redis.del(`user:${record.userCode}`));
    this.logger.log(`Device login approved for user ${userId}`);
    return { name: keyName(record.clientName) };
  }

  async deny(userCode: string): Promise<void> {
    const { key, record } = await this.findPending(userCode);
    record.status = 'denied';
    await this.run(() =>
      this.redis.set(key, JSON.stringify(record), 'KEEPTTL', 'XX'),
    );
    await this.run(() => this.redis.del(`user:${record.userCode}`));
  }

  private async findPending(
    userCode: string,
  ): Promise<{ key: string; record: DeviceRecord }> {
    const normalized = normalizeUserCode(userCode);
    const codeHash = normalized
      ? await this.run(() => this.redis.get(`user:${normalized}`))
      : null;
    const key = codeHash ? `code:${codeHash}` : '';
    const raw = key ? await this.run(() => this.redis.get(key)) : null;
    const record = raw ? (JSON.parse(raw) as DeviceRecord) : null;
    if (!record || record.status !== 'pending') {
      throw new NotFoundException('Login request not found or expired');
    }
    return { key, record };
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(
        `Device authorization Redis error: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Device login is temporarily unavailable',
      );
    }
  }
}

function keyName(clientName: string): string {
  return `CLI login: ${clientName}`.slice(0, 100);
}

function hashCode(deviceCode: string): string {
  return createHash('sha256').update(deviceCode).digest('hex');
}

export function generateUserCode(): string {
  let code = '';
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}

/** Uppercases and drops separators; returns '' for anything malformed. */
export function normalizeUserCode(input: string): string {
  const code = (input ?? '').toUpperCase().replace(/[\s-]/g, '');
  const valid = new RegExp(`^[${USER_CODE_ALPHABET}]{${USER_CODE_LENGTH}}$`);
  return valid.test(code) ? code : '';
}

export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
