import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { ApiHideProperty } from '@nestjs/swagger';

@Entity()
export class ServiceApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ApiHideProperty()
  @Column({ unique: true })
  hash: string;

  @Column({ nullable: true })
  expiresAt?: Date;

  @Column({ nullable: true })
  revokedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;
}
