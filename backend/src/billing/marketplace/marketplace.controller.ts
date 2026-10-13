import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type {
  MarketplaceLandingResponse,
  MarketplaceStatusResponse,
} from '@krakenkey/shared';
import { JwtOrApiKeyGuard } from '../../auth/guards/jwt-or-api-key.guard';
import { SessionOnly } from '../../auth/decorators/session-only.decorator';
import type { RequestWithUser } from '../../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../../throttler/interfaces/rate-limit-category.enum';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceTokenDto } from './dto/marketplace-token.dto';

/**
 * Microsoft Marketplace SaaS offer. The landing page routes serve the
 * dashboard's /marketplace page and the webhook serves Microsoft, so none of
 * this is part of the public API description.
 */
@Controller('billing/marketplace')
@ApiExcludeController()
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  /** Whether plans are sold through the Marketplace (the landing page asks first). */
  @Get('status')
  @RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
  status(): MarketplaceStatusResponse {
    return { enabled: this.marketplace.enabled };
  }

  /** Looks up a purchase for the landing page. */
  @Post('resolve')
  @HttpCode(200)
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async resolve(
    @Request() req: RequestWithUser,
    @Body() dto: MarketplaceTokenDto,
  ): Promise<MarketplaceLandingResponse> {
    this.marketplace.assertEnabled('POST', '/billing/marketplace/resolve');
    return this.marketplace.describe(req.user.userId, dto.token);
  }

  /** Links the purchase to the signed-in account and starts billing. */
  @Post('activate')
  @HttpCode(200)
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async activate(
    @Request() req: RequestWithUser,
    @Body() dto: MarketplaceTokenDto,
  ): Promise<MarketplaceLandingResponse> {
    this.marketplace.assertEnabled('POST', '/billing/marketplace/activate');
    return this.marketplace.activate(req.user.userId, dto.token);
  }

  /**
   * Fulfillment webhook. Authenticated by the Entra ID token Microsoft
   * sends, not by a KrakenKey credential. The body is read loosely:
   * Microsoft may add fields.
   */
  @Post('webhook')
  @HttpCode(200)
  @SkipThrottle()
  async webhook(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<{ received: true }> {
    this.marketplace.assertEnabled('POST', '/billing/marketplace/webhook');
    await this.marketplace.handleWebhook(authorization, body);
    return { received: true };
  }
}
