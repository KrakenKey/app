import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * An AWS Marketplace purchase whose registration token was resolved at the
 * fulfillment URL and is waiting for the buyer to sign in and link it to a
 * KrakenKey account. The buyer's browser carries a random id for it (the
 * `registration` query parameter); only its SHA-256 is stored, and the AWS
 * token itself is never stored. Rows expire after a day and are deleted by
 * the reconcile job.
 */
@Entity('aws_marketplace_registration')
export class AwsMarketplaceRegistration {
  /** SHA-256 (hex) of the id in the landing page URL. */
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  customerAwsAccountId: string;

  @Column({ type: 'varchar' })
  licenseArn: string;

  @Column({ type: 'varchar' })
  productCode: string;

  /** ResolveCustomer's Metadata.AgreementId, when AWS returns it. */
  @Column({ type: 'varchar', nullable: true })
  agreementId: string | null;

  /** `x-amzn-marketplace-offer-type`, sent by AWS for free trials only. */
  @Column({ type: 'varchar', nullable: true })
  offerType: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Index('IDX_aws_marketplace_registration_expiresAt')
  @Column({ type: 'timestamp' })
  expiresAt: Date;
}
