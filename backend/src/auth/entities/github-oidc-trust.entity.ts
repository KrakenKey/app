import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ApiKeyScope } from '@krakenkey/shared';
import { User } from '../../users/entities/user.entity';

/**
 * Lets GitHub Actions workflows in one repository exchange a GitHub OIDC
 * token for a short-lived API key with these scopes and restrictions.
 */
@Entity()
@Index('IDX_github_oidc_trust_userId', ['userId'])
export class GithubOidcTrust {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** `owner/name` as entered; matched case-insensitively. */
  @Column({ type: 'varchar', length: 200 })
  repository: string;

  /**
   * GitHub's numeric repository id. Pinned from the first verified token,
   * so a deleted and re-created repository with the same name is refused.
   */
  @Column({ type: 'text', nullable: true })
  repositoryId: string | null;

  /** Exact refs, or prefixes ending in `*` (e.g. `refs/tags/v*`); null = any. */
  @Column({ type: 'text', array: true, nullable: true })
  allowedRefs: string[] | null;

  /** If set, only jobs running in this GitHub environment match. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  environment: string | null;

  /** Same meaning as on UserApiKey: null = unrestricted. */
  @Column({ type: 'text', array: true, nullable: true })
  scopes: ApiKeyScope[] | null;

  @Column({ type: 'uuid', array: true, nullable: true })
  allowedDomainIds: string[] | null;

  @Column({ type: 'int', array: true, nullable: true })
  allowedCertIds: number[] | null;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastUsedRef: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
