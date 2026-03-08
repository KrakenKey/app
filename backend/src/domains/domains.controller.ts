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
import { CreateDomainDto } from './dto/create-domain.dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';

@Controller('domains')
@ApiTags('Domains')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new domain' })
  @ApiResponse({ status: 201, description: 'Domain registered' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  create(
    @Request() req: RequestWithUser,
    @Body() createDomainDto: CreateDomainDto,
  ) {
    return this.domainsService.create(req.user.userId, createDomainDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all domains' })
  @ApiResponse({
    status: 200,
    description: 'List of domains for the authenticated user',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findAll(@Request() req: RequestWithUser) {
    return this.domainsService.findAll(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get domain details' })
  @ApiParam({ name: 'id', description: 'Domain UUID' })
  @ApiResponse({ status: 200, description: 'Domain details' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.domainsService.findOne(id, req.user.userId);
  }

  @Post(':id/verify')
  @ApiOperation({ summary: 'Trigger DNS verification' })
  @ApiParam({ name: 'id', description: 'Domain UUID' })
  @ApiResponse({ status: 200, description: 'Verification initiated' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  verify(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.domainsService.verify(req.user.userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a domain' })
  @ApiParam({ name: 'id', description: 'Domain UUID' })
  @ApiResponse({ status: 200, description: 'Domain deleted' })
  @ApiResponse({ status: 404, description: 'Domain not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.domainsService.delete(req.user.userId, id);
  }
}
