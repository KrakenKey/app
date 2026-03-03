import {
  Controller,
  Get,
  UseGuards,
  Req,
  Redirect,
  Query,
  Post,
  Body,
  Delete,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import type { Request } from 'express';
import type { RequestWithUser } from './interfaces/request-with-user.interface';
import { JwtOrApiKeyGuard } from './guards/jwt-or-api-key.guard';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';

@Controller('auth')
@ApiTags('Authentication')
@RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('register')
  @Redirect()
  @ApiOperation({ summary: 'Redirect to registration' })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Authentik registration flow',
  })
  register() {
    return this.authService.getRegisterRedirect();
  }

  @Get('login')
  @Redirect()
  @ApiOperation({ summary: 'Redirect to SSO login' })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Authentik login flow',
  })
  login() {
    return this.authService.getLoginRedirect();
  }

  @Get('callback')
  @ApiOperation({ summary: 'OAuth callback' })
  @ApiQuery({ name: 'code', description: 'Authorization code from Authentik' })
  @ApiResponse({ status: 200, description: 'Returns JWT access token' })
  async callback(@Query('code') code: string) {
    return this.authService.handleCallback(code);
  }

  @Get('profile')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  getProfile(@Req() req: Request) {
    return req.user;
  }

  @Get('api-keys')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all API keys for the current user' })
  @ApiResponse({
    status: 200,
    description: 'List of API keys (metadata only, no secrets)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async listApiKeys(@Req() req: RequestWithUser) {
    return this.authService.listApiKeys(req.user.userId);
  }

  @Post('api-keys')
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

  @Delete('api-keys/:id')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete an API key' })
  @ApiParam({ name: 'id', description: 'API key UUID' })
  @ApiResponse({ status: 200, description: 'API key deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async deleteApiKey(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.authService.deleteApiKey(req.user.userId, id);
    return { message: 'API key deleted' };
  }
}
