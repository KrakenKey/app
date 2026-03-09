import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { ApiHideProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';

@Entity()
@Unique('UQ_domain_userId_hostname', ['userId', 'hostname'])
@Index('IDX_domain_userId_isVerified', ['userId', 'isVerified'])
export class Domain {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  hostname: string;

  @ApiHideProperty()
  @Column()
  verificationCode: string;

  @Column({ default: false })
  isVerified: boolean;

  @ManyToOne(() => User, (user) => user.domains)
  @JoinColumn({ name: 'userId' })
  owner: User;

  @Column()
  userId: string; // Foreign key column

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
