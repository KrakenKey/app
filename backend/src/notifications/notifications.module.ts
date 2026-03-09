import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailService } from './email.service';
import { User } from '../users/entities/user.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [EmailService],
  exports: [EmailService],
})
export class NotificationsModule {}
