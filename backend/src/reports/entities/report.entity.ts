import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import type { ReportStatus } from '@krakenkey/shared';
import { User } from '../../users/entities/user.entity';
import { ReportHost } from './report-host.entity';

@Entity()
@Index('IDX_report_userId_createdAt', ['userId', 'createdAt'])
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  owner: User;

  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: ReportStatus;

  @Column({ type: 'int' })
  hostCount: number;

  /** SHA-256 (hex) of the share token; the token itself is never stored. */
  @Index('IDX_report_shareTokenHash', { unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  shareTokenHash: string | null;

  @Column({ type: 'timestamp', nullable: true })
  shareCreatedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  shareExpiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  /** Deleted by the daily retention job after this time. */
  @Index('IDX_report_expiresAt')
  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @OneToMany(() => ReportHost, (h) => h.report)
  hosts: ReportHost[];
}
