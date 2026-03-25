import {
  Entity,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  PrimaryColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity()
@Index('IDX_probe_status', ['status'])
export class Probe {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column()
  name: string;

  @Column()
  version: string;

  /** 'standalone' | 'connected' | 'hosted' */
  @Column()
  mode: string;

  @Column({ nullable: true })
  region?: string;

  @Column()
  os: string;

  @Column()
  arch: string;

  @Column({ default: 'active' })
  status: string;

  /** Null for hosted probes (shared infra), set for connected probes via API key auth */
  @Column({ type: 'text', nullable: true })
  userId?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  owner?: User;

  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
