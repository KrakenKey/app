import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Probe } from './probe.entity';

@Entity()
@Index('IDX_probe_scan_result_probeId_scannedAt', ['probeId', 'scannedAt'])
@Index('IDX_probe_scan_result_userId_scannedAt', ['userId', 'scannedAt'])
@Index('IDX_probe_scan_result_host_port_scannedAt', [
  'host',
  'port',
  'scannedAt',
])
export class ProbeScanResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  probeId: string;

  @ManyToOne(() => Probe)
  @JoinColumn({ name: 'probeId' })
  probe: Probe;

  @Column()
  host: string;

  @Column({ type: 'int' })
  port: number;

  @Column({ nullable: true })
  sni?: string;

  @Column({ type: 'text', nullable: true })
  userId?: string;

  // --- Connection ---
  @Column()
  connectionSuccess: boolean;

  @Column({ type: 'text', nullable: true })
  connectionError?: string;

  @Column({ type: 'int', nullable: true })
  latencyMs?: number;

  @Column({ nullable: true })
  tlsVersion?: string;

  @Column({ nullable: true })
  cipherSuite?: string;

  @Column({ nullable: true })
  ocspStapled?: boolean;

  // --- Certificate ---
  @Column({ nullable: true })
  certSubject?: string;

  @Column('text', { array: true, nullable: true })
  certSans?: string[];

  @Column({ nullable: true })
  certIssuer?: string;

  @Column({ nullable: true })
  certSerialNumber?: string;

  @Column({ type: 'timestamp', nullable: true })
  certNotBefore?: Date;

  @Column({ type: 'timestamp', nullable: true })
  certNotAfter?: Date;

  @Column({ type: 'int', nullable: true })
  certDaysUntilExpiry?: number;

  @Column({ nullable: true })
  certKeyType?: string;

  @Column({ type: 'int', nullable: true })
  certKeySize?: number;

  @Column({ nullable: true })
  certSignatureAlgorithm?: string;

  @Column({ nullable: true })
  certFingerprint?: string;

  @Column({ type: 'int', nullable: true })
  certChainDepth?: number;

  @Column({ nullable: true })
  certChainComplete?: boolean;

  @Column({ nullable: true })
  certTrusted?: boolean;

  @Column({ type: 'timestamp' })
  scannedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
