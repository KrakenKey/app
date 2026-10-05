import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { DomainsService } from './domains.service';
import { ApiKeyAccessService } from '../auth/access/api-key-access.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import { RequireScope } from '../auth/decorators/require-scope.decorator';

@Controller('domains')
@ApiTags('Domains')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard, RoleGuard)
export class DomainsController {
  constructor(
    private readonly domainsService: DomainsService,
    private readonly keyAccess: ApiKeyAccessService,
  ) {}

  @Post()
  @RequireScope('domains:write')
  @ApiOperation({ summary: 'Register a new domain' })
  @ApiResponse({ status: 201, description: 'Domain registered' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Viewers cannot register domains' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  create(
    @Request() req: RequestWithUser,
    @Body() createDomainDto: CreateDomainDto,
  ) {
    this.keyAccess.assertCanAddDomain(req.user);
    return this.domainsService.create(req.user.userId, createDomainDto);
  }

  @Get()
  @RequireScope('domains:read')
  @ApiOperation({ summary: 'List all domains' })
  @ApiResponse({
    status: 200,
    description: 'List of domains for the authenticated user or their org',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async findAll(@Request() req: RequestWithUser) {
    const domains = await this.domainsService.findAll(req.user.userId);
    return this.keyAccess.filterDomains(req.user, domains);
  }

  @Get(':id')
  @RequireScope('domains:read')
  @ApiOperation({ summary: 'Get domain details' })
  @ApiParam({ name: 'id', description: 'Domain UUID' })
  @ApiResponse({ status: 200, description: 'Domain details' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    this.keyAccess.assertDomain(req.user, id);
    return this.domainsService.findOne(id, req.user.userId);
  }

  @Post(':id/verify')
  @RequireScope('domains:write')
  @ApiOperation({ summary: 'Trigger DNS verification' })
  @ApiParam({ name: 'id', description: 'Domain UUID' })
  @ApiResponse({ status: 200, description: 'Verification initiated' })
  @ApiResponse({ status: 403, description: 'Viewers cannot verify domains' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  verify(@Request() req: RequestWithUser, @Param('id') id: string) {
    this.keyAccess.assertDomain(req.user, id);
    return this.domainsService.verify(req.user.userId, id);
  }

  @Delete(':id')
  @RequireScope('domains:write')
  @ApiOperation({ summary: 'Delete a domain' })
  @ApiParam({ name: 'id', description: 'Domain UUID' })
  @ApiResponse({ status: 200, description: 'Domain deleted' })
  @ApiResponse({ status: 403, description: 'Viewers cannot delete domains' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    this.keyAccess.assertDomain(req.user, id);
    return this.domainsService.delete(req.user.userId, id);
  }
}
