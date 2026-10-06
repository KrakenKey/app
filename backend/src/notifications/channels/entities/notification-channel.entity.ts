import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import type {
  AlertEvent,
  NotificationChannelType,
  NotificationDeliveryStatus,
} from '@krakenkey/shared';
import { User } from '../../../users/entities/user.entity';

/**
 * A Slack, Microsoft Teams or webhook destination for alerts. The URL and
 * the webhook signing secret are stored encrypted (see channel-crypto.ts)
 * because the URL itself is the credential for Slack and Teams.
 */
@Entity()
@Index('IDX_notification_channel_userId', ['userId'])
export class NotificationChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  owner?: User;

  @Column({ type: 'varchar', length: 16 })
  type: NotificationChannelType;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text' })
  urlEncrypted: string;

  /** Webhook signing secret, encrypted. Null for Slack and Teams. */
  @Column({ type: 'text', nullable: true })
  secretEncrypted: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  events: AlertEvent[];

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastDeliveryAt: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  lastDeliveryStatus: NotificationDeliveryStatus | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
