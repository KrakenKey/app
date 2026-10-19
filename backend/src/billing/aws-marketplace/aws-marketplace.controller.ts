import {
  Body,
  Controller,
  Delete,
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

/**
 * What a plain visit to the fulfillment URL shows. AWS also checks that the
 * URL answers 200 before it accepts it for a product.
 */
const REGISTER_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>KrakenKey on AWS Marketplace</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5;">
<h1>KrakenKey on AWS Marketplace</h1>
<p>This page sets up KrakenKey after a purchase in AWS Marketplace. To continue, open your KrakenKey subscription in AWS Marketplace and choose <strong>Set up your account</strong>.</p>
<p>Need help? Visit <a href="https://krakenkey.io/support/">krakenkey.io/support</a>.</p>
</body>
</html>
`;

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

  /** A browser visiting the fulfillment URL directly, and AWS's URL check. */
  @Get('register')
  @RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
  registerPage(@Res() res: Response): void {
    // Served with the flag off too: AWS checks the URL while a product is
    // being set up, before purchases are turned on in that environment.
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').status(200).send(REGISTER_PAGE);
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

  /**
   * Removes an AWS Marketplace purchase that is linked to the account but
   * still waiting for AWS, so the account can subscribe another way. It
   * doesn't cancel anything in AWS. Available with the flag off too, since
   * links made before it was turned off stay on the account.
   */
  @Delete('pending')
  @HttpCode(204)
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async removePending(@Request() req: RequestWithUser): Promise<void> {
    await this.awsMarketplace.removePendingLink(req.user.userId);
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
