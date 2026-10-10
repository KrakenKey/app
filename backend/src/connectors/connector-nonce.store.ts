import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { CONNECTOR_NONCE_TTL_SECONDS } from '@krakenkey/shared';

/**
 * Remembers the nonces connectors sign with, per connector, so a captured
 * signed request can't be replayed. Uses the same Redis as BullMQ and the
 * API key lockout, under its own key prefix.
 *
 * Fails closed: without Redis no connector can get a key or rotate.
 */
@Injectable()
export class ConnectorNonceStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorNonceStore.name);
  private readonly redis: Redis;
  private redisWarned = false;

  constructor(config: ConfigService) {
    this.redis = new Redis({
      host: config.get<string>('KK_BULLMQ_HOST', 'localhost'),
      port: parseInt(config.get('KK_BULLMQ_PORT', '6379')),
      password: config.get<string>('KK_BULLMQ_PASSWORD', '') || undefined,
      keyPrefix: 'connector-nonce:',
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on('error', (err) => {
      if (!this.redisWarned) {
        this.redisWarned = true;
        this.logger.warn(
          `Redis unavailable for connector nonces: ${err.message}`,
        );
      }
    });
  }

  async onModuleInit() {
    try {
      await this.redis.connect();
    } catch (err) {
      this.logger.warn(
        `Redis connect failed for connector nonces: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  /**
   * Records a nonce for a connector. Returns false when the connector has
   * already used it within CONNECTOR_NONCE_TTL_SECONDS.
   */
  async claim(connectorId: string, nonce: string): Promise<boolean> {
    // Hashed so the stored key never contains the nonce itself
    const digest = createHash('sha256')
      .update(`${connectorId.toLowerCase()}\n${nonce}`)
      .digest('hex');
    try {
      const set = await this.redis.set(
        digest,
        '1',
        'EX',
        CONNECTOR_NONCE_TTL_SECONDS,
        'NX',
      );
      return set === 'OK';
    } catch (err) {
      this.logger.error(
        `Connector nonce check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Connector authentication is temporarily unavailable',
      );
    }
  }
}
