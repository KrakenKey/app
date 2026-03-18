import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { BillingService } from './billing.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { UpgradePlanDto } from './dto/upgrade-plan.dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';

@Controller('billing')
@ApiTags('Billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe Checkout session' })
  @ApiResponse({ status: 201, description: 'Checkout session created' })
  @ApiResponse({ status: 400, description: 'Plan not available' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async checkout(
    @Request() req: RequestWithUser,
    @Body() dto: CreateCheckoutDto,
  ) {
    const sessionUrl = await this.billingService.createCheckoutSession(
      req.user.userId,
      req.user.email ?? '',
      dto.plan,
    );
    return { sessionUrl };
  }

  @Get('subscription')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user's subscription" })
  @ApiResponse({ status: 200, description: 'Subscription details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async getSubscription(@Request() req: RequestWithUser) {
    const sub = await this.billingService.getSubscription(req.user.userId);
    if (!sub) {
      return {
        plan: 'free',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        organizationId: null,
      };
    }
    return {
      id: sub.id,
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      organizationId: sub.organizationId ?? null,
      createdAt: sub.createdAt,
    };
  }

  @Post('portal')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe Customer Portal session' })
  @ApiResponse({ status: 201, description: 'Portal session created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'No subscription found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async createPortal(@Request() req: RequestWithUser) {
    const portalUrl = await this.billingService.createPortalSession(
      req.user.userId,
    );
    return { portalUrl };
  }

  @Post('upgrade/preview')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Preview prorated cost for a plan upgrade' })
  @ApiResponse({ status: 200, description: 'Upgrade preview details' })
  @ApiResponse({ status: 400, description: 'Invalid upgrade path' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'No active subscription' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async previewUpgrade(
    @Request() req: RequestWithUser,
    @Body() dto: UpgradePlanDto,
  ) {
    return this.billingService.previewUpgrade(req.user.userId, dto.plan);
  }

  @Post('upgrade')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upgrade subscription with proration' })
  @ApiResponse({ status: 201, description: 'Subscription upgraded' })
  @ApiResponse({ status: 400, description: 'Invalid upgrade path' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'No active subscription' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async upgrade(@Request() req: RequestWithUser, @Body() dto: UpgradePlanDto) {
    return this.billingService.upgradeSubscription(req.user.userId, dto.plan);
  }

  @Post('webhook')
  @SkipThrottle()
  @ApiExcludeEndpoint()
  async webhook(
    @Request() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    let event;
    try {
      event = this.billingService.constructWebhookEvent(rawBody, signature);
    } catch (error) {
      throw new BadRequestException(
        `Webhook signature verification failed: ${error.message}`,
      );
    }

    await this.billingService.handleWebhookEvent(event);
    return { received: true };
  }
}
