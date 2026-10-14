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
import { ApiHideProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import type { Organization } from '../../organizations/entities/organization.entity';

@Entity()
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_subscription_userId')
  @Column({ type: 'text', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', nullable: true })
  @Index('IDX_subscription_organizationId')
  organizationId: string | null;

  /**
   * Null for an account that never started a Stripe checkout, e.g. one that
   * only bought through Microsoft Marketplace.
   */
  @ApiHideProperty()
  @Index('IDX_subscription_stripeCustomerId')
  @Column({ type: 'varchar', nullable: true })
  stripeCustomerId: string | null;

  @ApiHideProperty()
  @Index('IDX_subscription_stripeSubscriptionId')
  @Column({ type: 'varchar', nullable: true })
  stripeSubscriptionId: string | null;

  @Column({ default: 'free' })
  plan: string;

  @Column({ default: 'active' })
  status: string;

  /**
   * `month` or `year` for a Stripe subscription; null on the free plan, for
   * Marketplace subscriptions and for rows from before annual billing.
   */
  @Column({ type: 'varchar', length: 10, nullable: true, default: null })
  billingInterval: 'month' | 'year' | null;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ default: false })
  cancelAtPeriodEnd: boolean;

  /**
   * When the first payment of the current past_due run failed. The paid plan
   * keeps applying for PAST_DUE_GRACE_DAYS from here. Cleared when a payment
   * succeeds again or the subscription ends.
   */
  @Column({ type: 'timestamp', nullable: true, default: null })
  pastDueSince: Date | null;

  /**
   * Who bills this subscription: 'stripe' (direct) or 'marketplace'
   * (Microsoft Marketplace SaaS offer). Rows written before Marketplace
   * support are 'stripe'.
   */
  @Column({ type: 'varchar', default: 'stripe' })
  source: 'stripe' | 'marketplace';

  /** Microsoft's SaaS subscription id. Unique when set. */
  @ApiHideProperty()
  @Column({ type: 'varchar', nullable: true, default: null })
  marketplaceSubscriptionId: string | null;

  @ApiHideProperty()
  @Column({ type: 'varchar', nullable: true, default: null })
  marketplaceOfferId: string | null;

  /** The Marketplace plan id; `plan` holds the KrakenKey plan it maps to. */
  @ApiHideProperty()
  @Column({ type: 'varchar', nullable: true, default: null })
  marketplacePlanId: string | null;

  /** Microsoft's status: PendingFulfillmentStart, Subscribed, Suspended or Unsubscribed. */
  @Column({ type: 'varchar', nullable: true, default: null })
  marketplaceStatus: string | null;

  @ApiHideProperty()
  @Column({ type: 'integer', nullable: true, default: null })
  marketplaceQuantity: number | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne('Organization', { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
