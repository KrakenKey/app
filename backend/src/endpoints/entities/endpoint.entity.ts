import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { EndpointHostedRegion } from './endpoint-hosted-region.entity';

@Entity()
@Unique('UQ_endpoint_userId_host_port', ['userId', 'host', 'port'])
@Index('IDX_endpoint_userId_isActive', ['userId', 'isActive'])
export class Endpoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  owner: User;

  @Column()
  host: string;

  @Column({ type: 'int', default: 443 })
  port: number;

  @Column({ nullable: true })
  sni?: string;

  @Column({ nullable: true })
  label?: string;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => EndpointHostedRegion, (r) => r.endpoint)
  hostedRegions: EndpointHostedRegion[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
