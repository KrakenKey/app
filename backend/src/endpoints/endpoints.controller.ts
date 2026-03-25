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
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { EndpointsService } from './endpoints.service';
import { CreateEndpointDto } from './dto/create-endpoint.dto';
import { UpdateEndpointDto } from './dto/update-endpoint.dto';
import { AddHostedRegionDto } from './dto/add-hosted-region.dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';

@Controller('endpoints')
@ApiTags('Endpoints')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
export class EndpointsController {
  constructor(private readonly endpointsService: EndpointsService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new monitored endpoint' })
  @ApiResponse({ status: 201, description: 'Endpoint created' })
  @ApiResponse({ status: 403, description: 'Plan limit exceeded' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  create(@Request() req: RequestWithUser, @Body() dto: CreateEndpointDto) {
    return this.endpointsService.create(req.user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all monitored endpoints' })
  @ApiResponse({ status: 200, description: 'List of endpoints' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findAll(@Request() req: RequestWithUser) {
    return this.endpointsService.findAll(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get endpoint details' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 200, description: 'Endpoint details' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.endpointsService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 200, description: 'Endpoint updated' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  update(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateEndpointDto,
  ) {
    return this.endpointsService.update(id, req.user.userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 200, description: 'Endpoint deleted' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.endpointsService.delete(id, req.user.userId);
  }

  @Post(':id/regions')
  @ApiOperation({ summary: 'Add a hosted probe region to an endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 201, description: 'Region added' })
  @ApiResponse({ status: 403, description: 'Plan limit exceeded' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  addRegion(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: AddHostedRegionDto,
  ) {
    return this.endpointsService.addHostedRegion(
      id,
      req.user.userId,
      dto.region,
    );
  }

  @Delete(':id/regions/:region')
  @ApiOperation({ summary: 'Remove a hosted probe region from an endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiParam({ name: 'region', description: 'Region identifier' })
  @ApiResponse({ status: 200, description: 'Region removed' })
  @ApiResponse({ status: 404, description: 'Region not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  removeRegion(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('region') region: string,
  ) {
    return this.endpointsService.removeHostedRegion(
      id,
      req.user.userId,
      region,
    );
  }

  @Get(':id/results')
  @ApiOperation({ summary: 'Get paginated scan results for an endpoint' })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Scan results' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  getResults(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.endpointsService.getResults(
      id,
      req.user.userId,
      page ? parseInt(page, 10) : 1,
      limit ? Math.min(parseInt(limit, 10), 100) : 20,
    );
  }

  @Get(':id/results/latest')
  @ApiOperation({
    summary: 'Get the latest scan result per probe for an endpoint',
  })
  @ApiParam({ name: 'id', description: 'Endpoint UUID' })
  @ApiResponse({ status: 200, description: 'Latest scan results by probe' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  getLatestResults(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.endpointsService.getLatestResults(id, req.user.userId);
  }
}
