import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import type {
  ReportHostResult,
  ReportHostStatus,
  ReportSeverity,
} from '@krakenkey/shared';
import { Report } from './report.entity';

@Entity()
@Unique('UQ_report_host_reportId_host_port', ['reportId', 'host', 'port'])
@Index('IDX_report_host_reportId_severity', ['reportId', 'severity'])
export class ReportHost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  reportId: string;

  @ManyToOne(() => Report, (r) => r.hosts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reportId' })
  report: Report;

  /** Order the host appeared in the submitted list. */
  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'varchar', length: 253 })
  host: string;

  @Column({ type: 'int', default: 443 })
  port: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: ReportHostStatus;

  @Column({ type: 'varchar', length: 16, nullable: true })
  severity: ReportSeverity | null;

  /** Classified scan result, set once the host has been scanned. */
  @Column({ type: 'jsonb', nullable: true })
  result: ReportHostResult | null;

  @Column({ type: 'timestamp', nullable: true })
  scannedAt: Date | null;
}
