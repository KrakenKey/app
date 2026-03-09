import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiHideProperty } from '@nestjs/swagger';
import { User } from '../../../users/entities/user.entity';
import type { CertStatus, ParsedCsr } from '@krakenkey/shared';

@Entity()
@Index('IDX_tls_crt_userId', ['userId'])
@Index('IDX_tls_crt_status_autoRenew_expiresAt', [
  'status',
  'autoRenew',
  'expiresAt',
])
export class TlsCrt {
  @PrimaryGeneratedColumn()
  id: number;

  @ApiHideProperty()
  @Column()
  rawCsr: string;

  @Column('jsonb')
  parsedCsr: ParsedCsr;

  @Column({ type: 'text', nullable: true })
  crtPem: string | null;

  @Column({ type: 'text', default: 'pending', nullable: true })
  status: CertStatus;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastRenewedAt: Date | null;

  @Column({ default: true })
  autoRenew: boolean;

  @Column({ type: 'int', default: 0 })
  renewalCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastRenewalAttemptAt: Date | null;

  @Column({ type: 'int', nullable: true })
  revocationReason: number | null;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  userId: string;

  @ManyToOne(() => User, (user) => user.tlsCrts)
  @JoinColumn({ name: 'userId' })
  user: User;
}
