import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtOrApiKeyGuard } from '../guards/jwt-or-api-key.guard';
import { SessionOnly } from '../decorators/session-only.decorator';
import { RequireScope } from '../decorators/require-scope.decorator';
import type { RequestWithUser } from '../interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../../throttler/interfaces/rate-limit-category.enum';
import { GithubOidcService } from './github-oidc.service';
import {
  CreateGithubOidcTrustDto,
  GithubOidcExchangeDto,
} from './github-oidc.dto';

@Controller('auth/github-oidc')
@ApiTags('GitHub OIDC')
export class GithubOidcController {
  constructor(private readonly oidc: GithubOidcService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Exchange a GitHub Actions OIDC token for a short-lived API key (15 minutes)',
  })
  @ApiResponse({ status: 200, description: 'Short-lived API key' })
  @ApiResponse({
    status: 401,
    description: 'Token invalid, expired or for another audience',
  })
  @ApiResponse({
    status: 403,
    description: 'No trust policy matches the repository, ref and environment',
  })
  @ApiResponse({
    status: 409,
    description: 'Several trust policies match; pass trustId',
  })
  @RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
  exchange(@Body() dto: GithubOidcExchangeDto, @Req() req: Request) {
    return this.oidc.exchange(dto.token, dto.trustId, req.ip);
  }

  @Get('trusts')
  @UseGuards(JwtOrApiKeyGuard)
  @RequireScope('account:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List GitHub OIDC trust policies' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  list(@Req() req: RequestWithUser) {
    return this.oidc.list(req.user.userId);
  }

  @Post('trusts')
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Trust a GitHub repository to exchange OIDC tokens for keys (dashboard session only)',
  })
  @ApiResponse({ status: 201, description: 'Trust policy created' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  create(@Req() req: RequestWithUser, @Body() dto: CreateGithubOidcTrustDto) {
    return this.oidc.create(req.user.userId, dto);
  }

  @Delete('trusts/:id')
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a GitHub OIDC trust policy (dashboard session only)',
  })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async remove(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.oidc.remove(req.user.userId, id);
    return { message: 'Trust policy deleted' };
  }
}
