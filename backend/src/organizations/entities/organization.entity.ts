import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  OneToOne,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Subscription } from '../../billing/entities/subscription.entity';

@Entity()
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text' })
  @Index('IDX_org_ownerId')
  ownerId: string;

  @Column({ type: 'varchar', default: 'active' })
  status: 'active' | 'dissolving';

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @OneToMany(() => User, (user) => user.organization)
  members: User[];

  @OneToOne(() => Subscription, (sub) => sub.organization)
  subscription: Subscription;
}
