import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import type {
  Connector,
  ConnectorEnrolResponse,
  ConnectorEnrolmentTokenResponse,
  ConnectorTokenResponse,
  CreateConnectorResponse,
} from '@krakenkey/shared';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { SessionOnly } from '../auth/decorators/session-only.decorator';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import { ConnectorsService } from './connectors.service';
import {
  ConnectorEnrolDto,
  ConnectorRotateDto,
  ConnectorTokenDto,
  CreateConnectorDto,
  UpdateConnectorDto,
} from './dto/connector.dto';

@Controller('connectors')
@ApiTags('Connectors')
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  // --- Dashboard ------------------------------------------------------------

  @Get()
  @UseGuards(JwtOrApiKeyGuard)
  @RequireScope('account:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List connectors, including revoked ones' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  list(@Req() req: RequestWithUser): Promise<Connector[]> {
    return this.connectors.list(req.user.userId);
  }

  @Get(':id')
  @UseGuards(JwtOrApiKeyGuard)
  @RequireScope('account:read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a connector' })
  @ApiResponse({ status: 404, description: 'Connector not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  get(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Connector> {
    return this.connectors.get(req.user.userId, id);
  }

  @Post()
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Create a connector and its single-use enrolment token (dashboard session only)',
  })
  @ApiResponse({
    status: 201,
    description: 'Connector created; the enrolment token is shown once',
  })
  @ApiResponse({ status: 402, description: 'Connector limit reached' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  create(
    @Req() req: RequestWithUser,
    @Body() dto: CreateConnectorDto,
  ): Promise<CreateConnectorResponse> {
    return this.connectors.create(req.user.userId, dto);
  }

  @Post(':id/enrolment-token')
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Issue a new enrolment token for a connector that has not enrolled (dashboard session only)',
  })
  @ApiResponse({
    status: 201,
    description: 'New token; any previous token stops working',
  })
  @ApiResponse({ status: 409, description: 'Already enrolled or revoked' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  reissueToken(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConnectorEnrolmentTokenResponse> {
    return this.connectors.reissueEnrolmentToken(req.user.userId, id);
  }

  @Patch(':id')
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Rename a connector or change its client label (dashboard session only)',
  })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  update(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateConnectorDto,
  ): Promise<Connector> {
    return this.connectors.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Revoke a connector and every key it was issued (dashboard session only)',
  })
  @ApiResponse({ status: 204, description: 'Revoked' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async revoke(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.connectors.revoke(req.user.userId, id);
  }

  // --- Connector (no bearer token) -------------------------------------------

  @Post('enrol')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Enrol a connector with its single-use token and public key',
  })
  @ApiResponse({ status: 200, description: 'Enrolled' })
  @ApiResponse({ status: 401, description: 'Invalid enrolment token' })
  @RateLimitCategoryDecorator(RateLimitCategory.PUBLIC_STRICT)
  enrol(
    @Body() dto: ConnectorEnrolDto,
    @Req() req: Request,
  ): Promise<ConnectorEnrolResponse> {
    return this.connectors.enrol(dto, req.ip);
  }

  @Post('token')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a signed request for an API key that lasts one hour',
  })
  @ApiResponse({ status: 200, description: 'Short-lived API key' })
  @ApiResponse({ status: 401, description: 'Invalid connector credentials' })
  @RateLimitCategoryDecorator(RateLimitCategory.PUBLIC_STRICT)
  token(
    @Body() dto: ConnectorTokenDto,
    @Req() req: Request,
  ): Promise<ConnectorTokenResponse> {
    return this.connectors.exchangeToken(dto, req.ip);
  }

  @Post('rotate')
  @HttpCode(204)
  @ApiOperation({
    summary: "Replace a connector's public key, signed by the current key",
  })
  @ApiResponse({ status: 204, description: 'Key replaced' })
  @ApiResponse({ status: 401, description: 'Invalid connector credentials' })
  @RateLimitCategoryDecorator(RateLimitCategory.PUBLIC_STRICT)
  async rotate(
    @Body() dto: ConnectorRotateDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.connectors.rotate(dto, req.ip);
  }
}
