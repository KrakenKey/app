import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { EndpointsService } from './endpoints.service';
import { ApiKeyAccessService } from '../auth/access/api-key-access.service';
import { CreateEndpointDto } from './dto/create-endpoint.dto';
import { UpdateEndpointDto } from './dto/update-endpoint.dto';
import { AddHostedRegionDto } from './dto/add-hosted-region.dto';
import { AssignProbesDto } from './dto/assign-probes.dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import { RequireScope } from '../auth/decorators/require-scope.decorator';

@Controller('endpoints')
@ApiTags('Endpoints')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard, RoleGuard)
export class EndpointsController {
  constructor(
    private readonly endpointsService: EndpointsService,
    private readonly keyAccess: ApiKeyAccessService,
  ) {}

  /**
   * For API keys limited to specific domains: 404 unless the endpoint's host
   * is under one of them. No-op for everyone else.
   */
  private async checkKeyAccess(req: RequestWithUser, id: string) {
    if (!req.user.apiKey?.allowedDomainIds) return;
    const endpoint = await this.endpointsService.findOne(id, req.user.userId);
    await this.keyAccess.assertEndpoint(req.user, endpoint);
  }

  @Post()
  @RequireScope('endpoints:write')
  @ApiOperation({ summary: 'Register a new monitored endpoint' })
  @ApiResponse({ status: 201, description: 'Endpoint created' })
  @ApiResponse({ status: 403, description: 'Plan limit exceeded' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async create(
    @Request() req: RequestWithUser,
    @Body() dto: CreateEndpointDto,
  ) {
    await this.keyAccess.assertCanMonitorHost(req.user, dto.host);
    return this.endpointsService.create(req.user.userId, dto);
  }

  @Get()
  @RequireScope('endpoints:read')
  @ApiOperation({ summary: 'List all monitored endpoints' })
  @ApiResponse({ status: 200, description: 'List of endpoints' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async findAll(@Request() req: RequestWithUser) {
    const endpoints = await this.endpointsService.findAll(req.user.userId);
    return this.keyAccess.filterEndpoints(req.user, endpoints);
  }

  @Get(':id')
  @RequireScope('endpoints:read')
  @ApiOperation({ summary: 'Get endpoint details' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 200, description: 'Endpoint details' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    const endpoint = await this.endpointsService.findOne(id, req.user.userId);
    await this.keyAccess.assertEndpoint(req.user, endpoint);
    return endpoint;
  }

  @Patch(':id')
  @RequireScope('endpoints:write')
  @ApiOperation({ summary: 'Update endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 200, description: 'Endpoint updated' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async update(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateEndpointDto,
  ) {
    await this.checkKeyAccess(req, id);
    return this.endpointsService.update(id, req.user.userId, dto);
  }

  @Delete(':id')
  @RequireScope('endpoints:write')
  @ApiOperation({ summary: 'Delete an endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 200, description: 'Endpoint deleted' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    await this.checkKeyAccess(req, id);
    return this.endpointsService.delete(id, req.user.userId);
  }

  @Get('probes/mine')
  @RequireScope('endpoints:read')
  @ApiOperation({
    summary: "List the user's connected probes available for assignment",
  })
  @ApiResponse({ status: 200, description: 'List of connected probes' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  listUserProbes(@Request() req: RequestWithUser) {
    return this.endpointsService.listUserProbes(req.user.userId);
  }

  @Post(':id/probes')
  @RequireScope('endpoints:write')
  @ApiOperation({ summary: 'Assign connected probes to an endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 201, description: 'Probes assigned' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async assignProbes(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: AssignProbesDto,
  ) {
    await this.checkKeyAccess(req, id);
    return this.endpointsService.assignProbes(
      id,
      req.user.userId,
      dto.probeIds,
    );
  }

  @Delete(':id/probes/:probeId')
  @RequireScope('endpoints:write')
  @ApiOperation({ summary: 'Unassign a connected probe from an endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiParam({ name: 'probeId', description: 'Probe ID' })
  @ApiResponse({ status: 200, description: 'Probe unassigned' })
  @ApiResponse({ status: 404, description: 'Assignment not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async unassignProbe(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('probeId') probeId: string,
  ) {
    await this.checkKeyAccess(req, id);
    return this.endpointsService.unassignProbe(id, req.user.userId, probeId);
  }

  @Post(':id/regions')
  @RequireScope('endpoints:write')
  @ApiOperation({ summary: 'Add a hosted probe region to an endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 201, description: 'Region added' })
  @ApiResponse({ status: 403, description: 'Plan limit exceeded' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async addRegion(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: AddHostedRegionDto,
  ) {
    await this.checkKeyAccess(req, id);
    return this.endpointsService.addHostedRegion(
      id,
      req.user.userId,
      dto.region,
    );
  }

  @Delete(':id/regions/:region')
  @RequireScope('endpoints:write')
  @ApiOperation({ summary: 'Remove a hosted probe region from an endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiParam({ name: 'region', description: 'Region identifier' })
  @ApiResponse({ status: 200, description: 'Region removed' })
  @ApiResponse({ status: 404, description: 'Region not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async removeRegion(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('region') region: string,
  ) {
    await this.checkKeyAccess(req, id);
    return this.endpointsService.removeHostedRegion(
      id,
      req.user.userId,
      region,
    );
  }

  @Post(':id/scan')
  @RequireScope('endpoints:write')
  @ApiOperation({
    summary: 'Request an on-demand scan of this endpoint',
  })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 200, description: 'Scan requested' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async requestScan(@Request() req: RequestWithUser, @Param('id') id: string) {
    await this.checkKeyAccess(req, id);
    return this.endpointsService.requestScan(id, req.user.userId);
  }

  @Get(':id/results')
  @RequireScope('endpoints:read')
  @ApiOperation({ summary: 'Get paginated scan results for an endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Scan results' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async getResults(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.checkKeyAccess(req, id);
    return this.endpointsService.getResults(
      id,
      req.user.userId,
      page ? parseInt(page, 10) : 1,
      limit ? Math.min(parseInt(limit, 10), 100) : 20,
    );
  }

  @Get(':id/results/export')
  @RequireScope('endpoints:read')
  @ApiOperation({ summary: 'Export raw scan results as CSV or JSON' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'csv'],
    description: 'Export format (default: json)',
  })
  @ApiResponse({ status: 200, description: 'Exported scan results' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async exportResults(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    await this.checkKeyAccess(req, id);
    const fmt = format === 'csv' ? 'csv' : 'json';
    const result = await this.endpointsService.exportResults(
      id,
      req.user.userId,
      fmt,
    );
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.data);
  }

  @Get(':id/results/latest')
  @RequireScope('endpoints:read')
  @ApiOperation({
    summary: 'Get the latest scan result per probe for an endpoint',
  })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 200, description: 'Latest scan results by probe' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async getLatestResults(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ) {
    await this.checkKeyAccess(req, id);
    return this.endpointsService.getLatestResults(id, req.user.userId);
  }
}
