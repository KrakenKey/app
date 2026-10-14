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
import { PlanLimitsService } from './limits/plan-limits.service';
import { Connector } from '../connectors/entities/connector.entity';
import { NotificationChannel } from '../notifications/channels/entities/notification-channel.entity';
import { GithubOidcTrust } from '../auth/entities/github-oidc-trust.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Subscription,
      User,
      Organization,
      MarketplaceOperation,
      Connector,
      NotificationChannel,
      GithubOidcTrust,
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
    PlanLimitsService,
  ],
  exports: [BillingService, SubscriptionTierResolver, PlanLimitsService],
})
export class BillingModule {}
