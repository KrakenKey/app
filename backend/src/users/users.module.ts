import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AccountDeletionService } from './services/account-deletion.service';
import { User } from './entities/user.entity';
import { Domain } from '../domains/entities/domain.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';
import { UserApiKey } from '../auth/entities/user-api-key.entity';
import { Feedback } from '../feedback/entities/feedback.entity';
import { TlsModule } from '../certs/tls/tls.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Domain, TlsCrt, UserApiKey, Feedback]),
    TlsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, AccountDeletionService],
  exports: [UsersService],
})
export class UsersModule {}
