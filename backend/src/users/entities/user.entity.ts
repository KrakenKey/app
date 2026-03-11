import { UserApiKey } from '../../auth/entities/user-api-key.entity';
import {
  Entity,
  PrimaryColumn,
  Column,
  OneToMany,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Domain } from '../../domains/entities/domain.entity';
import { TlsCrt } from '../../certs/tls/entities/tls-crt.entity';
import type { NotificationPreferences, OrgRole } from '@krakenkey/shared';
import type { Organization } from '../../organizations/entities/organization.entity';

@Entity()
export class User {
  @PrimaryColumn({ type: 'text' }) // Authentik's sub is not a UUID
  id: string;

  @Column()
  username: string;

  @Column({ unique: true })
  email: string;

  @Column('text', { array: true, default: '{}' })
  groups: string[];

  @Column({ type: 'varchar', nullable: true })
  displayName: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  notificationPreferences: NotificationPreferences;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  autoRenewalConfirmedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  autoRenewalReminderSentAt: Date | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  role: OrgRole | null;

  @Column({ type: 'uuid', nullable: true, default: null })
  organizationId: string | null;

  @ManyToOne('Organization', 'members', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @OneToMany(() => UserApiKey, (apiKey) => apiKey.user)
  apiKeys: UserApiKey[];

  @OneToMany(() => Domain, (domain) => domain.owner, { nullable: true })
  domains?: Domain[];

  @OneToMany(() => TlsCrt, (tlsCrt) => tlsCrt.user)
  tlsCrts: TlsCrt[];
}
