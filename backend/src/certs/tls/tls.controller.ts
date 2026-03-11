import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Patch,
  Param,
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
import { TlsService } from './tls.service';
import { CreateTlsCrtDto } from './dto/create-tls-crt.dto';
import { UpdateTlsCrtDto } from './dto/update-tls-crt.dto';
import { RevokeTlsCrtDto } from './dto/revoke-tls-crt.dto';
import { JwtOrApiKeyGuard } from '../../auth/guards/jwt-or-api-key.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { RequestWithUser } from '../../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../../throttler/interfaces/rate-limit-category.enum';

@Controller('certs/tls')
@ApiTags('TLS Certificates')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
export class TlsController {
  constructor(private readonly tlsService: TlsService) {}

  @Get()
  @ApiOperation({ summary: 'List all TLS certificates' })
  @ApiResponse({
    status: 200,
    description: 'List of certificates for the authenticated user or their org',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findAll(@Request() req: RequestWithUser) {
    return this.tlsService.findAll(req.user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Request a new TLS certificate' })
  @ApiResponse({ status: 201, description: 'Certificate request submitted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Viewers cannot request certificates' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  create(
    @Request() req: RequestWithUser,
    @Body() createTlsCrtDto: CreateTlsCrtDto,
  ) {
    return this.tlsService.create(req.user.userId, createTlsCrtDto);
  }

  @Get(':id/details')
  @ApiOperation({ summary: 'Get parsed certificate details from issued cert' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Parsed certificate details' })
  @ApiResponse({ status: 400, description: 'Certificate not yet issued' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  getDetails(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.tlsService.getDetails(+id, req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get certificate details' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate details' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.tlsService.findOne(+id, req.user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a certificate' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate updated' })
  @ApiResponse({ status: 403, description: 'Viewers cannot update certificates' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  update(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateTlsCrtDto: UpdateTlsCrtDto,
  ) {
    return this.tlsService.update(+id, req.user.userId, updateTlsCrtDto);
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revoke a certificate' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate revocation initiated' })
  @ApiResponse({ status: 400, description: 'Certificate not in issued state' })
  @ApiResponse({ status: 403, description: 'Viewers cannot revoke certificates' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  revoke(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() revokeTlsCrtDto: RevokeTlsCrtDto,
  ) {
    return this.tlsService.revoke(+id, req.user.userId, revokeTlsCrtDto.reason);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a failed or revoked certificate' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate deleted' })
  @ApiResponse({
    status: 400,
    description: 'Certificate not in failed or revoked state',
  })
  @ApiResponse({ status: 403, description: 'Viewers cannot delete certificates' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.tlsService.remove(+id, req.user.userId);
  }

  @Post(':id/renew')
  @ApiOperation({ summary: 'Renew a certificate' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate renewal initiated' })
  @ApiResponse({ status: 403, description: 'Viewers cannot renew certificates' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  renew(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.tlsService.renew(+id, req.user.userId);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed certificate issuance' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate retry initiated' })
  @ApiResponse({ status: 400, description: 'Certificate not in failed state' })
  @ApiResponse({ status: 403, description: 'Viewers cannot retry certificates' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  retry(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.tlsService.retry(+id, req.user.userId);
  }
}
