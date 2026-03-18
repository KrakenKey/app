import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Subscription } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SubscriptionTierResolver } from './services/subscription-tier-resolver.service';
import { OrgDissolutionProcessor } from './processors/org-dissolution.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, User, Organization]),
    BullModule.registerQueue({
      name: 'orgDissolution',
    }),
  ],
  controllers: [BillingController],
  providers: [
    BillingService,
    SubscriptionTierResolver,
    OrgDissolutionProcessor,
  ],
  exports: [BillingService, SubscriptionTierResolver],
})
export class BillingModule {}
