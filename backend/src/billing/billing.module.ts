import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './entities/subscription.entity';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SubscriptionTierResolver } from './services/subscription-tier-resolver.service';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription])],
  controllers: [BillingController],
  providers: [BillingService, SubscriptionTierResolver],
  exports: [BillingService, SubscriptionTierResolver],
})
export class BillingModule {}
