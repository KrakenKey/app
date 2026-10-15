import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import type {
  AwsMarketplaceLandingResponse,
  AwsMarketplaceStatusResponse,
} from '@krakenkey/shared';
import { JwtOrApiKeyGuard } from '../../auth/guards/jwt-or-api-key.guard';
import { SessionOnly } from '../../auth/decorators/session-only.decorator';
import type { RequestWithUser } from '../../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../../throttler/interfaces/rate-limit-category.enum';
import { AwsMarketplaceService } from './aws-marketplace.service';
import { AwsMarketplaceRegistrationDto } from './dto/aws-marketplace-registration.dto';

/** Form fields AWS posts to the fulfillment URL. */
const TOKEN_FIELD = 'x-amzn-marketplace-token';
const OFFER_TYPE_FIELD = 'x-amzn-marketplace-offer-type';

/**
 * AWS Marketplace SaaS contract. The fulfillment URL serves the buyer's
 * browser (redirected from AWS) and the other routes serve the dashboard's
 * /aws-marketplace page, so none of this is part of the public API
 * description.
 */
@Controller('billing/aws-marketplace')
@ApiExcludeController()
export class AwsMarketplaceController {
  constructor(private readonly awsMarketplace: AwsMarketplaceService) {}

  /** Whether plans are sold through AWS Marketplace (the landing page asks first). */
  @Get('status')
  @RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
  status(): AwsMarketplaceStatusResponse {
    return { enabled: this.awsMarketplace.enabled };
  }

  /**
   * Fulfillment URL. After a purchase, and when the buyer chooses "Set up
   * your account", AWS has the buyer's browser POST a form with
   * `x-amzn-marketplace-token` (and `x-amzn-marketplace-offer-type` for a
   * free trial). Unauthenticated: the token is checked with ResolveCustomer
   * and nothing else in the request is trusted. The browser is sent on to
   * the landing page with 303 See Other, carrying a new random id, never
   * the token.
   */
  @Post('register')
  @RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
  async register(
    @Body() body: Record<string, unknown> | undefined,
    @Res() res: Response,
  ): Promise<void> {
    this.awsMarketplace.assertEnabled(
      'POST',
      '/billing/aws-marketplace/register',
    );
    const url = await this.awsMarketplace.register(
      body?.[TOKEN_FIELD],
      body?.[OFFER_TYPE_FIELD],
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(303, url);
  }

  /** Looks up a resolved purchase for the landing page. */
  @Post('resolve')
  @HttpCode(200)
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async resolve(
    @Request() req: RequestWithUser,
    @Body() dto: AwsMarketplaceRegistrationDto,
  ): Promise<AwsMarketplaceLandingResponse> {
    this.awsMarketplace.assertEnabled(
      'POST',
      '/billing/aws-marketplace/resolve',
    );
    return this.awsMarketplace.describe(req.user.userId, dto.registration);
  }

  /** Links the purchase to the signed-in account (or its organization). */
  @Post('link')
  @HttpCode(200)
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async link(
    @Request() req: RequestWithUser,
    @Body() dto: AwsMarketplaceRegistrationDto,
  ): Promise<AwsMarketplaceLandingResponse> {
    this.awsMarketplace.assertEnabled('POST', '/billing/aws-marketplace/link');
    return this.awsMarketplace.link(req.user.userId, dto.registration);
  }
}
