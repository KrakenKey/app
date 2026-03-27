import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Endpoint } from './endpoint.entity';
import { Probe } from '../../probes/entities/probe.entity';

@Entity()
@Unique('UQ_endpoint_probe_assignment', ['endpointId', 'probeId'])
@Index('IDX_endpoint_probe_assignment_probeId', ['probeId'])
export class EndpointProbeAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  endpointId: string;

  @ManyToOne(() => Endpoint, (e) => e.probeAssignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'endpointId' })
  endpoint: Endpoint;

  @Column({ type: 'varchar' })
  probeId: string;

  @ManyToOne(() => Probe, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'probeId' })
  probe: Probe;

  @CreateDateColumn()
  createdAt: Date;
}
