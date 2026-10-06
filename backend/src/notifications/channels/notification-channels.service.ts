import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  DEFAULT_ALERT_EVENTS,
  MAX_NOTIFICATION_CHANNELS,
  type CreateNotificationChannelResponse,
  type NotificationChannel as NotificationChannelView,
  type RotateNotificationChannelSecretResponse,
  type TestNotificationChannelResponse,
} from '@krakenkey/shared';
import { NotificationChannel } from './entities/notification-channel.entity';
import type {
  CreateNotificationChannelDto,
  UpdateNotificationChannelDto,
} from './dto/notification-channel.dto';
import { ChannelUrlError, validateChannelUrl } from './channel-url';
import { generateWebhookSecret, maskUrl } from './channel-crypto';
import { ChannelDeliveryService } from './channel-delivery.service';
import { recordDelivery } from './alert-delivery.processor';
import type { AlertMessage } from './alert-payloads';

@Injectable()
export class NotificationChannelsService {
  constructor(
    @InjectRepository(NotificationChannel)
    private readonly repo: Repository<NotificationChannel>,
    private readonly delivery: ChannelDeliveryService,
  ) {}

  async list(userId: string): Promise<NotificationChannelView[]> {
    const channels = await this.repo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    return channels.map((c) => this.toView(c));
  }

  async create(
    userId: string,
    dto: CreateNotificationChannelDto,
  ): Promise<CreateNotificationChannelResponse> {
    const count = await this.repo.count({ where: { userId } });
    if (count >= MAX_NOTIFICATION_CHANNELS) {
      throw new BadRequestException(
        `You can have at most ${MAX_NOTIFICATION_CHANNELS} notification channels. Delete one before adding another.`,
      );
    }
    await this.checkUrl(dto.type, dto.url);

    const secret = dto.type === 'webhook' ? generateWebhookSecret() : null;
    const channel = this.repo.create({
      userId,
      type: dto.type,
      name: dto.name.trim(),
      urlEncrypted: this.delivery.encrypt(dto.url),
      secretEncrypted: secret ? this.delivery.encrypt(secret) : null,
      events: dto.events ?? [...DEFAULT_ALERT_EVENTS],
      enabled: dto.enabled ?? true,
      lastDeliveryAt: null,
      lastDeliveryStatus: null,
      lastError: null,
    });
    const saved = await this.repo.save(channel);
    const view: CreateNotificationChannelResponse = this.toView(saved);
    if (secret) view.secret = secret;
    return view;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateNotificationChannelDto,
  ): Promise<NotificationChannelView> {
    const channel = await this.findOwned(id, userId);
    if (dto.url !== undefined) {
      await this.checkUrl(channel.type, dto.url);
      channel.urlEncrypted = this.delivery.encrypt(dto.url);
    }
    if (dto.name !== undefined) channel.name = dto.name.trim();
    if (dto.events !== undefined) channel.events = dto.events;
    if (dto.enabled !== undefined) channel.enabled = dto.enabled;
    const saved = await this.repo.save(channel);
    return this.toView(saved);
  }

  async remove(id: string, userId: string): Promise<void> {
    const channel = await this.findOwned(id, userId);
    await this.repo.remove(channel);
  }

  /** Sends a `test` alert right away (no queue, no retries). */
  async test(
    id: string,
    userId: string,
  ): Promise<TestNotificationChannelResponse> {
    const channel = await this.findOwned(id, userId);
    const message: AlertMessage = {
      id: randomUUID(),
      event: 'test',
      createdAt: new Date().toISOString(),
      payload: {
        subject: `Channel "${channel.name}" is set up`,
        details: {
          note: 'This is a test message sent from the KrakenKey dashboard.',
        },
      },
    };
    const result = await this.delivery.deliver(channel, message);
    await recordDelivery(this.repo, channel.id, result);
    return { ok: result.ok, status: result.status, error: result.error };
  }

  /** New webhook signing secret; the old one stops working immediately. */
  async rotateSecret(
    id: string,
    userId: string,
  ): Promise<RotateNotificationChannelSecretResponse> {
    const channel = await this.findOwned(id, userId);
    if (channel.type !== 'webhook') {
      throw new BadRequestException(
        'Only webhook channels have a signing secret',
      );
    }
    const secret = generateWebhookSecret();
    channel.secretEncrypted = this.delivery.encrypt(secret);
    await this.repo.save(channel);
    return { secret };
  }

  private async findOwned(
    id: string,
    userId: string,
  ): Promise<NotificationChannel> {
    const channel = await this.repo.findOne({ where: { id, userId } });
    if (!channel) {
      throw new NotFoundException('Notification channel not found');
    }
    return channel;
  }

  private async checkUrl(
    type: NotificationChannel['type'],
    url: string,
  ): Promise<void> {
    try {
      await validateChannelUrl(type, url);
    } catch (err) {
      if (err instanceof ChannelUrlError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  private toView(c: NotificationChannel): NotificationChannelView {
    let urlMasked = '…';
    try {
      urlMasked = maskUrl(this.delivery.decrypt(c.urlEncrypted));
    } catch {
      // Undecryptable (secret rotated); show the placeholder.
    }
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      urlMasked,
      events: c.events ?? [],
      enabled: c.enabled,
      hasSecret: Boolean(c.secretEncrypted),
      lastDeliveryAt: c.lastDeliveryAt
        ? new Date(c.lastDeliveryAt).toISOString()
        : null,
      lastDeliveryStatus: c.lastDeliveryStatus ?? null,
      lastError: c.lastError ?? null,
      createdAt: new Date(c.createdAt).toISOString(),
      updatedAt: new Date(c.updatedAt).toISOString(),
    };
  }
}
