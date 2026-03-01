import { UserApiKey } from 'src/auth/entities/user-api-key.entity';
import { Entity, PrimaryColumn, Column, OneToMany } from 'typeorm';
import { Domain } from '../../domains/entities/domain.entity';
import { TlsCrt } from '../../certs/tls/entities/tls-crt.entity';

@Entity()
export class User {
  @PrimaryColumn({ type: 'text' }) // Authentik's sub is not a UUID
  id: string;

  @Column()
  username: string;

  @Column()
  email: string;

  @Column('text', { array: true, default: '{}' })
  groups: string[];

  @OneToMany(() => UserApiKey, (apiKey) => apiKey.user)
  apiKeys: UserApiKey[];

  @OneToMany(() => Domain, (domain) => domain.owner, { nullable: true })
  domains?: Domain[];

  @OneToMany(() => TlsCrt, (tlsCrt) => tlsCrt.user)
  tlsCrts: TlsCrt[];
}
