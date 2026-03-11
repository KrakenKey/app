import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { Organization } from './entities/organization.entity';
import { User } from '../users/entities/user.entity';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, User]), BillingModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
