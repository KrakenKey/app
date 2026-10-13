import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * A Microsoft Marketplace webhook operation KrakenKey has handled. The
 * operation id is the primary key, so a redelivered webhook is recognized
 * and acknowledged without being applied again.
 */
@Entity('marketplace_operation')
export class MarketplaceOperation {
  /** Microsoft's operation id (the webhook payload's `id`). */
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Index('IDX_marketplace_operation_subscriptionId')
  @Column({ type: 'varchar' })
  subscriptionId: string;

  /** Subscribe, ChangePlan, ChangeQuantity, Suspend, Reinstate, Renew or Unsubscribe. */
  @Column({ type: 'varchar' })
  action: string;

  /** applied, rejected (reported as Failure to Microsoft) or ignored. */
  @Column({ type: 'varchar' })
  result: 'applied' | 'rejected' | 'ignored';

  /** Why it was rejected or ignored. */
  @Column({ type: 'text', nullable: true })
  detail: string | null;

  /** The answer Microsoft waits for (ChangePlan, ChangeQuantity, Reinstate), if any. */
  @Column({ type: 'varchar', nullable: true })
  ackStatus: 'Success' | 'Failure' | null;

  /** Organization this operation dissolves, so a redelivery can re-queue it. */
  @Column({ type: 'uuid', nullable: true })
  dissolveOrganizationId: string | null;

  @Column({ type: 'boolean', nullable: true })
  dissolveCancel: boolean | null;

  @CreateDateColumn()
  createdAt: Date;
}
