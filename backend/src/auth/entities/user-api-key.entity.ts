import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiHideProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';

@Entity()
@Index('IDX_user_api_key_userId', ['userId'])
export class UserApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ApiHideProperty()
  @Column({ unique: true })
  hash: string;

  @Column({ nullable: true })
  expiresAt?: Date;

  /** Set when the key is revoked; revoked keys never authenticate. */
  @Column({ type: 'timestamp', nullable: true })
  revokedAt?: Date | null;

  /** Updated on successful auth, at most once a minute unless the IP changes. */
  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  lastUsedIp?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.apiKeys, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'text' }) // Authentik sub is text, not UUID
  userId: string;
}
