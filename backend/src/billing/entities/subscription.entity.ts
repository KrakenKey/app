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

  @ApiHideProperty()
  @Index('IDX_subscription_stripeCustomerId')
  @Column()
  stripeCustomerId: string;

  @ApiHideProperty()
  @Index('IDX_subscription_stripeSubscriptionId')
  @Column({ type: 'varchar', nullable: true })
  stripeSubscriptionId: string | null;

  @Column({ default: 'free' })
  plan: string;

  @Column({ default: 'active' })
  status: string;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ default: false })
  cancelAtPeriodEnd: boolean;

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
