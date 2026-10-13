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
import { MarketplaceOperation } from './marketplace/entities/marketplace-operation.entity';
import { MarketplaceConfig } from './marketplace/marketplace.config';
import { MarketplaceController } from './marketplace/marketplace.controller';
import { MarketplaceFulfillmentClient } from './marketplace/marketplace-fulfillment.client';
import { MarketplaceService } from './marketplace/marketplace.service';
import { MarketplaceWebhookVerifier } from './marketplace/marketplace-webhook.verifier';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Subscription,
      User,
      Organization,
      MarketplaceOperation,
    ]),
    BullModule.registerQueue({
      name: 'orgDissolution',
    }),
  ],
  controllers: [BillingController, MarketplaceController],
  providers: [
    BillingService,
    SubscriptionTierResolver,
    OrgDissolutionProcessor,
    MarketplaceConfig,
    MarketplaceFulfillmentClient,
    MarketplaceWebhookVerifier,
    MarketplaceService,
  ],
  exports: [BillingService, SubscriptionTierResolver],
})
export class BillingModule {}
