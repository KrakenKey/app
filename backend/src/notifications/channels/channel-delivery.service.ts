import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptSecretValue,
  deriveChannelKey,
  encryptSecretValue,
} from './channel-crypto';
import { ChannelUrlError, validateChannelUrl } from './channel-url';
import {
  buildSlackBody,
  buildTeamsBody,
  buildWebhookBody,
  dashboardLink,
  signWebhookPayload,
  type AlertMessage,
} from './alert-payloads';
import { HttpPostError, postJson } from './http-post';
import type { NotificationChannel } from './entities/notification-channel.entity';

export const DELIVERY_TIMEOUT_MS = 10_000;
export const MAX_LAST_ERROR_LENGTH = 500;
export const WEBHOOK_USER_AGENT = 'KrakenKey-Webhooks/1';

export interface DeliveryResult {
  ok: boolean;
  /** HTTP status, when the destination answered. */
  status: number | null;
  /** Safe to store and show: never contains the URL or secret. */
  error: string | null;
  /** True when another attempt may succeed (network error, 408, 429, 5xx). */
  retryable: boolean;
}

/**
 * Encrypts channel credentials and sends one alert to one channel. Never
 * logs or returns decrypted URLs or secrets.
 */
@Injectable()
export class ChannelDeliveryService {
  private readonly logger = new Logger(ChannelDeliveryService.name);
  private key: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  private get cryptoKey(): Buffer {
    if (!this.key) {
      this.key = deriveChannelKey(
        this.config.get<string>('KK_HMAC_SECRET') ?? '',
      );
    }
    return this.key;
  }

  encrypt(plaintext: string): string {
    return encryptSecretValue(plaintext, this.cryptoKey);
  }

  decrypt(stored: string): string {
    return decryptSecretValue(stored, this.cryptoKey);
  }

  private get appDomain(): string {
    return this.config.get<string>('KK_APP_DOMAIN') || 'app.krakenkey.io';
  }

  async deliver(
    channel: NotificationChannel,
    msg: AlertMessage,
  ): Promise<DeliveryResult> {
    let rawUrl: string;
    let secret: string | null = null;
    try {
      rawUrl = this.decrypt(channel.urlEncrypted);
      if (channel.type === 'webhook' && channel.secretEncrypted) {
        secret = this.decrypt(channel.secretEncrypted);
      }
    } catch {
      this.logger.error(
        `Cannot decrypt notification channel ${channel.id}; was KK_HMAC_SECRET changed?`,
      );
      return fail('Stored channel credentials could not be decrypted', false);
    }

    let url: URL;
    try {
      // Re-checked on every send: a webhook host's DNS may have changed.
      url = await validateChannelUrl(channel.type, rawUrl);
    } catch (err) {
      if (err instanceof ChannelUrlError) {
        return fail(err.message, err.transient);
      }
      throw err;
    }

    const link = dashboardLink(this.appDomain, msg.payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': WEBHOOK_USER_AGENT,
    };
    let body: string;
    switch (channel.type) {
      case 'slack':
        body = JSON.stringify(buildSlackBody(msg, link));
        break;
      case 'teams':
        body = JSON.stringify(buildTeamsBody(msg, link));
        break;
      case 'webhook':
        body = JSON.stringify(buildWebhookBody(msg, link));
        headers['X-KrakenKey-Event'] = msg.event;
        headers['X-KrakenKey-Delivery'] = msg.id;
        if (secret) {
          headers['X-KrakenKey-Signature'] = signWebhookPayload(
            secret,
            body,
            Math.floor(Date.now() / 1000),
          );
        }
        break;
      default:
        return fail('Unknown channel type', false);
    }

    let status: number;
    try {
      ({ status } = await postJson(url, body, headers, {
        timeoutMs: DELIVERY_TIMEOUT_MS,
      }));
    } catch (err) {
      if (err instanceof HttpPostError) {
        return fail(err.message, err.code !== 'EPRIVATEADDR');
      }
      return fail('Network error', true);
    }

    return classifyStatus(status);
  }
}

function fail(error: string, retryable: boolean): DeliveryResult {
  return {
    ok: false,
    status: null,
    error: error.slice(0, MAX_LAST_ERROR_LENGTH),
    retryable,
  };
}

/**
 * 2xx is delivered. 408, 429 and 5xx are retried. Any other status
 * (including 3xx, since redirects are not followed) is a permanent failure:
 * the URL is wrong or was revoked, so retrying would not help.
 */
export function classifyStatus(status: number): DeliveryResult {
  if (status >= 200 && status < 300) {
    return { ok: true, status, error: null, retryable: false };
  }
  const retryable = status === 408 || status === 429 || status >= 500;
  const error =
    status >= 300 && status < 400
      ? `HTTP ${status} (redirects are not followed)`
      : `HTTP ${status}`;
  return { ok: false, status, error, retryable };
}
