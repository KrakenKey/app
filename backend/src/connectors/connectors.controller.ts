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
  Put,
  Query,
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
  ConnectorDeployment,
  ConnectorEnrollResponse,
  ConnectorEnrollmentTokenResponse,
  ConnectorReportResponse,
  ConnectorTokenResponse,
  CreateConnectorResponse,
} from '@krakenkey/shared';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SessionOnly } from '../auth/decorators/session-only.decorator';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import { ConnectorsService } from './connectors.service';
import { ConnectorReportsService } from './connector-reports.service';
import {
  ConnectorDeploymentsQueryDto,
  ConnectorReportDto,
} from './dto/connector-report.dto';
import { ConnectorConfigDto } from './dto/connector-config.dto';
import {
  ConnectorEnrollDto,
  ConnectorRotateDto,
  ConnectorTokenDto,
  CreateConnectorDto,
  UpdateConnectorDto,
} from './dto/connector.dto';

@Controller('connectors')
@ApiTags('Connectors')
export class ConnectorsController {
  constructor(
    private readonly connectors: ConnectorsService,
    private readonly reports: ConnectorReportsService,
  ) {}

  // --- Dashboard ------------------------------------------------------------

  @Get()
  @UseGuards(JwtOrApiKeyGuard)
  @RequireScope('account:read')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List connectors, including revoked ones, with counts of their deployments',
  })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async list(@Req() req: RequestWithUser): Promise<Connector[]> {
    const connectors = await this.connectors.list(req.user.userId);
    const summaries = await this.reports.summaries(
      req.user,
      connectors.map((c) => c.id),
    );
    return connectors.map((c) => ({
      ...c,
      deploymentSummary: summaries.get(c.id),
    }));
  }

  // Declared before :id so "deployments" isn't taken for an id
  @Get('deployments')
  @UseGuards(JwtOrApiKeyGuard)
  @RequireScope('account:read')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Where a certificate is deployed, across the user's active connectors",
  })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  deployments(
    @Req() req: RequestWithUser,
    @Query() query: ConnectorDeploymentsQueryDto,
  ): Promise<ConnectorDeployment[]> {
    return this.reports.forCertificate(req.user, query.certificateId);
  }

  // --- Connector config summary (connector-issued key) -------------------------
  // Declared before :id so "config" isn't taken for an id

  @Put('config')
  @UseGuards(JwtOrApiKeyGuard)
  @RequireScope('certs:read')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Share a read-only summary of the connector's config (connector-issued keys only)",
  })
  @ApiResponse({
    status: 204,
    description:
      'Stored, replacing the previous summary; certificates outside the connector restrictions are kept and flagged in the dashboard',
  })
  @ApiResponse({ status: 403, description: 'Not a connector-issued key' })
  @RateLimitCategoryDecorator(RateLimitCategory.CONNECTOR_REPORT)
  async putConfig(
    @Req() req: RequestWithUser,
    @Body() dto: ConnectorConfigDto,
  ): Promise<void> {
    await this.connectors.storeConfig(req.user, dto);
  }

  @Delete('config')
  @UseGuards(JwtOrApiKeyGuard)
  @RequireScope('certs:read')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Clear the connector's shared config summary (connector-issued keys only)",
  })
  @ApiResponse({
    status: 204,
    description: 'Cleared, also when nothing was stored',
  })
  @ApiResponse({ status: 403, description: 'Not a connector-issued key' })
  @RateLimitCategoryDecorator(RateLimitCategory.CONNECTOR_REPORT)
  async deleteConfig(@Req() req: RequestWithUser): Promise<void> {
    await this.connectors.clearConfig(req.user);
  }

  // --- Dashboard (continued) -------------------------------------------------

  @Get(':id')
  @UseGuards(JwtOrApiKeyGuard)
  @RequireScope('account:read')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get a connector with its deployments and the config summary it last shared',
  })
  @ApiResponse({ status: 404, description: 'Connector not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async get(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Connector> {
    const connector = await this.connectors.get(req.user.userId, id);
    return {
      ...connector,
      deployments: await this.reports.forConnector(req.user, connector),
    };
  }

  @Post()
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard, RoleGuard)
  @Roles('owner', 'admin', 'member')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Create a connector and its single-use enrollment token (dashboard session only)',
  })
  @ApiResponse({
    status: 201,
    description: 'Connector created; the enrollment token is shown once',
  })
  @ApiResponse({ status: 402, description: 'Connector limit reached' })
  @ApiResponse({ status: 403, description: 'Viewers cannot add connectors' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  create(
    @Req() req: RequestWithUser,
    @Body() dto: CreateConnectorDto,
  ): Promise<CreateConnectorResponse> {
    return this.connectors.create(req.user.userId, dto);
  }

  @Post(':id/enrollment-token')
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard, RoleGuard)
  @Roles('owner', 'admin', 'member')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Issue a new enrollment token for a connector that has not enrolled (dashboard session only)',
  })
  @ApiResponse({
    status: 201,
    description: 'New token; any previous token stops working',
  })
  @ApiResponse({ status: 409, description: 'Already enrolled or revoked' })
  @ApiResponse({ status: 403, description: 'Viewers cannot add connectors' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  reissueToken(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConnectorEnrollmentTokenResponse> {
    return this.connectors.reissueEnrollmentToken(req.user.userId, id);
  }

  @Patch(':id')
  @SessionOnly()
  @UseGuards(JwtOrApiKeyGuard, RoleGuard)
  @Roles('owner', 'admin', 'member')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Rename a connector or change its client label (dashboard session only)',
  })
  @ApiResponse({ status: 403, description: 'Viewers cannot change connectors' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  update(
    @Req() req: RequestWithUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateConnectorDto,
  ): Promise<Connector> {
    return this.connectors.update(req.user.userId, id, dto);
  }

  // No @Roles(): like deleting an API key, revoking only shuts off the
  // caller's own credentials, so a user moved to viewer can still do it.
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

  // --- Connector (connector-issued key) ---------------------------------------

  @Post('report')
  @UseGuards(JwtOrApiKeyGuard)
  @RequireScope('certs:read')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Report where the connector deployed each certificate (connector-issued keys only)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Stored; certificates outside the connector restrictions are skipped and listed in rejectedCertificateIds',
  })
  @ApiResponse({ status: 403, description: 'Not a connector-issued key' })
  @RateLimitCategoryDecorator(RateLimitCategory.CONNECTOR_REPORT)
  report(
    @Req() req: RequestWithUser,
    @Body() dto: ConnectorReportDto,
  ): Promise<ConnectorReportResponse> {
    return this.reports.report(req.user, dto);
  }

  // --- Connector (no bearer token) -------------------------------------------

  @Post('enroll')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Enroll a connector with its single-use token and public key',
  })
  @ApiResponse({ status: 200, description: 'Enrolled' })
  @ApiResponse({ status: 401, description: 'Invalid enrollment token' })
  @RateLimitCategoryDecorator(RateLimitCategory.PUBLIC_STRICT)
  enroll(
    @Body() dto: ConnectorEnrollDto,
    @Req() req: Request,
  ): Promise<ConnectorEnrollResponse> {
    return this.connectors.enroll(dto, req.ip);
  }

  @Post('token')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a signed request for an API key that lasts one hour',
  })
  @ApiResponse({ status: 200, description: 'Short-lived API key' })
  @ApiResponse({ status: 401, description: 'Invalid connector credentials' })
  @RateLimitCategoryDecorator(RateLimitCategory.CONNECTOR_TOKEN)
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
