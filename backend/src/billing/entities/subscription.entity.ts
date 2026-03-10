import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { ApiHideProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';

@Entity()
@Unique('UQ_subscription_userId', ['userId'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_subscription_userId')
  @Column()
  userId: string;

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

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
