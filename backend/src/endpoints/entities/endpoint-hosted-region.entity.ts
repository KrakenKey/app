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

@Entity()
@Unique('UQ_endpoint_hosted_region_endpointId_region', ['endpointId', 'region'])
@Index('IDX_endpoint_hosted_region_region', ['region'])
export class EndpointHostedRegion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  endpointId: string;

  @ManyToOne(() => Endpoint, (e) => e.hostedRegions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'endpointId' })
  endpoint: Endpoint;

  @Column()
  region: string;

  @CreateDateColumn()
  createdAt: Date;
}
