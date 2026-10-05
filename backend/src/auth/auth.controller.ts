import {
  Controller,
  Get,
  Patch,
  UseGuards,
  Req,
  Res,
  Query,
  Post,
  Body,
  Delete,
  Param,
  ForbiddenException,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { RequestWithUser } from './interfaces/request-with-user.interface';
import { JwtOrApiKeyGuard } from './guards/jwt-or-api-key.guard';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  CreateDeviceCodeDto,
  DeviceTokenDto,
  DeviceUserCodeDto,
} from './dto/device-auth.dto';
import { DeviceAuthService } from './services/device-auth.service';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import { SessionOnly } from './decorators/session-only.decorator';
import type { LogoutUrlResponse } from '@krakenkey/shared';

const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

@Controller('auth')
@ApiTags('Authentication')
@RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly deviceAuthService: DeviceAuthService,
  ) {}

  @Get('register')
  @ApiOperation({ summary: 'Redirect to registration' })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Authentik registration flow',
  })
  register(@Res() res: Response) {
    const { url, state } = this.authService.getRegisterRedirect();
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: OAUTH_STATE_MAX_AGE_MS,
      path: '/auth/callback',
    });
    res.redirect(302, url);
  }

  @Get('login')
  @ApiOperation({ summary: 'Redirect to SSO login' })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Authentik login flow',
  })
  login(@Res() res: Response) {
    const { url, state } = this.authService.getLoginRedirect();
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: OAUTH_STATE_MAX_AGE_MS,
      path: '/auth/callback',
    });
    res.redirect(302, url);
  }

  @Get('logout-url')
  @ApiOperation({
    summary: 'Get the SSO logout URL',
    description:
      'Returns the Authentik end-session endpoint and the post-logout redirect URI. ' +
      'The client adds its ID token as id_token_hint and sends the browser there, ' +
      'so the token goes to Authentik and not to this API.',
  })
  @ApiResponse({
    status: 200,
    description: 'End-session URL and post-logout redirect URI',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          example:
            'https://auth.krakenkey.io/application/o/krakenkey/end-session/',
        },
        postLogoutRedirectUri: {
          type: 'string',
          example: 'https://app.krakenkey.io',
        },
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Authentik is not configured' })
  getLogoutUrl(): LogoutUrlResponse {
    return this.authService.getLogoutUrl();
  }

  @Get('callback')
  @ApiOperation({ summary: 'OAuth callback' })
  @ApiQuery({ name: 'code', description: 'Authorization code from Authentik' })
  @ApiQuery({
    name: 'state',
    description: 'OAuth state parameter for CSRF protection',
  })
  @ApiResponse({ status: 200, description: 'Returns JWT access token' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/auth/callback' });
    return this.authService.handleCallback(code, state, cookieState);
  }

  @Get('profile')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile with resource counts' })
  @ApiResponse({ status: 200, description: 'Full user profile data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  getProfile(@Req() req: RequestWithUser) {
    return this.authService.getFullProfile(req.user.userId);
  }

  @Patch('profile')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Updated user profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  updateProfile(@Req() req: RequestWithUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.userId, dto);
  }

  @Get('api-keys')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List API keys for the current user' })
  @ApiQuery({
    name: 'includeRevoked',
    required: false,
    description:
      'true to also list keys revoked in the last 30 days (with revokedAt set)',
  })
  @ApiResponse({
    status: 200,
    description:
      'List of API keys (metadata only, no secrets), with lastUsedAt and lastUsedIp',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async listApiKeys(
    @Req() req: RequestWithUser,
    @Query('includeRevoked') includeRevoked?: string,
  ) {
    return this.authService.listApiKeys(req.user.userId, {
      includeRevoked: includeRevoked === 'true',
    });
  }

  @Post('api-keys')
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an API key' })
  @ApiResponse({ status: 201, description: 'API key created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async createApiKey(
    @Req() req: RequestWithUser,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.authService.createApiKey(
      req.user.userId,
      dto.name,
      dto.expiresAt,
    );
  }

  @Post('confirm-auto-renewal')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm intent to keep auto-renewal active (free tier)',
  })
  @ApiResponse({
    status: 201,
    description: 'Auto-renewal confirmation timestamp reset',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  confirmAutoRenewal(@Req() req: RequestWithUser) {
    return this.authService.confirmAutoRenewal(req.user.userId);
  }

  @Delete('api-keys/:id')
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke an API key',
    description:
      'The key stops working immediately. It stays listed with includeRevoked for 30 days.',
  })
  @ApiParam({ name: 'id', description: 'API key UUID' })
  @ApiResponse({ status: 200, description: 'API key revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 404,
    description: 'API key not found or already revoked',
  })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async deleteApiKey(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.authService.revokeApiKey(req.user.userId, id);
    return { message: 'API key revoked' };
  }

  // ── CLI device login (krakenkey auth login --web) ──────────────────────

  @Post('device/code')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start a CLI browser login',
    description:
      'Returns a device code for the CLI to poll with and a user code for the user to approve in the dashboard.',
  })
  @ApiResponse({ status: 200, description: 'Device and user codes issued' })
  async createDeviceCode(
    @Req() req: Request,
    @Body() dto: CreateDeviceCodeDto,
  ) {
    return this.deviceAuthService.createDeviceCode(
      dto.clientName,
      req.ip ?? '',
    );
  }

  @Post('device/token')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Poll a CLI browser login',
    description:
      'Returns status pending, slow_down, denied or expired, or approved with a new API key. The key is returned once.',
  })
  @ApiResponse({ status: 200, description: 'Current login status' })
  async pollDeviceToken(@Body() dto: DeviceTokenDto) {
    return this.deviceAuthService.pollToken(dto.deviceCode);
  }

  @Get('device/:userCode')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Show a pending CLI login before approving it' })
  @ApiParam({ name: 'userCode', description: 'User code shown by the CLI' })
  @ApiResponse({ status: 403, description: 'Called with an API key' })
  @ApiResponse({ status: 404, description: 'Not found or expired' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async getDeviceRequest(
    @Req() req: RequestWithUser,
    @Param('userCode') userCode: string,
  ) {
    assertBrowserSession(req);
    return this.deviceAuthService.getRequest(userCode);
  }

  @Post('device/approve')
  @HttpCode(200)
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Approve a CLI login',
    description:
      'Creates an API key for the signed-in user and hands it to the waiting CLI. Requires a dashboard session; API keys cannot approve logins.',
  })
  @ApiResponse({ status: 402, description: 'API key limit reached' })
  @ApiResponse({ status: 403, description: 'Called with an API key' })
  @ApiResponse({ status: 404, description: 'Not found or expired' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async approveDevice(
    @Req() req: RequestWithUser,
    @Body() dto: DeviceUserCodeDto,
  ) {
    assertBrowserSession(req);
    return this.deviceAuthService.approve(dto.userCode, req.user.userId);
  }

  @Post('device/deny')
  @HttpCode(200)
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deny a CLI login' })
  @ApiResponse({ status: 403, description: 'Called with an API key' })
  @ApiResponse({ status: 404, description: 'Not found or expired' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async denyDevice(
    @Req() req: RequestWithUser,
    @Body() dto: DeviceUserCodeDto,
  ) {
    assertBrowserSession(req);
    await this.deviceAuthService.deny(dto.userCode);
    return { message: 'Login request denied' };
  }
}

/**
 * Device logins must be approved by a person in the dashboard. An API key
 * approving one would let any key mint further keys without a human.
 */
function assertBrowserSession(req: RequestWithUser): void {
  if ((req.user as { apiKeyId?: string }).apiKeyId) {
    throw new ForbiddenException(
      'CLI logins must be approved from the dashboard',
    );
  }
}
