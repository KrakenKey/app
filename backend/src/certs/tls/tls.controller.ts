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
  Query,
  Res,
  HttpStatus,
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
import { TlsService } from './tls.service';
import { ApiKeyAccessService } from '../../auth/access/api-key-access.service';
import { CreateTlsCrtDto } from './dto/create-tls-crt.dto';
import { UpdateTlsCrtDto } from './dto/update-tls-crt.dto';
import { RevokeTlsCrtDto } from './dto/revoke-tls-crt.dto';
import { JwtOrApiKeyGuard } from '../../auth/guards/jwt-or-api-key.guard';
import { RoleGuard } from '../../auth/guards/role.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { RequestWithUser } from '../../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../../throttler/interfaces/rate-limit-category.enum';
import { RequireScope } from '../../auth/decorators/require-scope.decorator';

@Controller('certs/tls')
@ApiTags('TLS Certificates')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard, RoleGuard)
export class TlsController {
  constructor(
    private readonly tlsService: TlsService,
    private readonly keyAccess: ApiKeyAccessService,
  ) {}

  /**
   * For API keys limited to specific domains or certificates: 404 unless
   * the certificate is inside those limits. No-op for everyone else.
   */
  private async checkKeyAccess(req: RequestWithUser, id: number) {
    if (!this.keyAccess.isRestricted(req.user)) return;
    const cert = await this.tlsService.findOne(id, req.user.userId);
    await this.keyAccess.assertCert(req.user, cert);
  }

  @Get()
  @RequireScope('certs:read')
  @ApiOperation({ summary: 'List all TLS certificates' })
  @ApiResponse({
    status: 200,
    description: 'List of certificates for the authenticated user or their org',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async findAll(@Request() req: RequestWithUser) {
    const certs = await this.tlsService.findAll(req.user.userId);
    return this.keyAccess.filterCerts(req.user, certs);
  }

  @Post()
  @RequireScope('certs:issue')
  @ApiOperation({ summary: 'Request a new TLS certificate' })
  @ApiResponse({ status: 201, description: 'Certificate request submitted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Viewers cannot request certificates',
  })
  @ApiResponse({
    status: 409,
    description:
      'An identical certificate request (same CSR) is already being processed. ' +
      'Duplicate requests within 15 minutes return the original certificate instead of creating a new one.',
  })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  async create(
    @Request() req: RequestWithUser,
    @Body() createTlsCrtDto: CreateTlsCrtDto,
  ) {
    const restrictToHostnames = await this.keyAccess.issuanceHostnames(
      req.user,
    );
    return this.tlsService.create(req.user.userId, createTlsCrtDto, {
      restrictToHostnames,
    });
  }

  @Get(':id/details')
  @RequireScope('certs:read')
  @ApiOperation({ summary: 'Get parsed certificate details from issued cert' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Parsed certificate details' })
  @ApiResponse({ status: 400, description: 'Certificate not yet issued' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async getDetails(@Request() req: RequestWithUser, @Param('id') id: string) {
    await this.checkKeyAccess(req, +id);
    return this.tlsService.getDetails(+id, req.user.userId);
  }

  @Get(':id/chain')
  @RequireScope('certs:read')
  @ApiOperation({
    summary: 'Get full certificate chain with parsed details',
  })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({
    status: 200,
    description:
      'Full chain info: leaf cert details, intermediate details, and full chain PEM',
  })
  @ApiResponse({ status: 400, description: 'Certificate not yet issued' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async getChain(@Request() req: RequestWithUser, @Param('id') id: string) {
    await this.checkKeyAccess(req, +id);
    return this.tlsService.getChain(+id, req.user.userId);
  }

  @Get(':id')
  @RequireScope('certs:read')
  @ApiOperation({ summary: 'Get certificate details' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate details' })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    const cert = await this.tlsService.findOne(+id, req.user.userId);
    await this.keyAccess.assertCert(req.user, cert);
    return cert;
  }

  @Patch(':id')
  @RequireScope('certs:renew')
  @ApiOperation({ summary: 'Update a certificate' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate updated' })
  @ApiResponse({
    status: 403,
    description: 'Viewers cannot update certificates',
  })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async update(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateTlsCrtDto: UpdateTlsCrtDto,
  ) {
    await this.checkKeyAccess(req, +id);
    return this.tlsService.update(+id, req.user.userId, updateTlsCrtDto);
  }

  @Post(':id/revoke')
  @RequireScope('certs:revoke')
  @ApiOperation({ summary: 'Revoke a certificate' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate revocation initiated' })
  @ApiResponse({ status: 400, description: 'Certificate not in issued state' })
  @ApiResponse({
    status: 403,
    description: 'Viewers cannot revoke certificates',
  })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  async revoke(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() revokeTlsCrtDto: RevokeTlsCrtDto,
  ) {
    await this.checkKeyAccess(req, +id);
    return this.tlsService.revoke(+id, req.user.userId, revokeTlsCrtDto.reason);
  }

  @Delete(':id')
  @RequireScope('certs:revoke')
  @ApiOperation({ summary: 'Delete a failed or revoked certificate' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate deleted' })
  @ApiResponse({
    status: 400,
    description: 'Certificate not in failed or revoked state',
  })
  @ApiResponse({
    status: 403,
    description: 'Viewers cannot delete certificates',
  })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    await this.checkKeyAccess(req, +id);
    return this.tlsService.remove(+id, req.user.userId);
  }

  @Post(':id/renew')
  @RequireScope('certs:renew')
  @ApiOperation({ summary: 'Renew a certificate' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiQuery({
    name: 'ifDue',
    required: false,
    type: Boolean,
    description:
      'Only renew if the certificate is inside its plan renewal window ' +
      '(free: 5 days, paid: 30 days before expiry). Otherwise nothing is ' +
      'queued and the response has skipped: true. Default: false (always renew).',
  })
  @ApiResponse({
    status: 201,
    description: 'Certificate renewal initiated (skipped: false)',
  })
  @ApiResponse({
    status: 200,
    description:
      'ifDue=true and the certificate is not due yet; nothing was queued ' +
      "(skipped: true, reason: 'not_due')",
  })
  @ApiResponse({
    status: 400,
    description: 'Certificate not issued or missing CSR data',
  })
  @ApiResponse({
    status: 403,
    description: 'Viewers cannot renew certificates',
  })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  async renew(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
    @Query('ifDue') ifDue?: string,
  ) {
    await this.checkKeyAccess(req, +id);
    const result = await this.tlsService.renew(+id, req.user.userId, {
      ifDue: ifDue === 'true',
    });
    // Nothing was created, so a skip is a plain 200 rather than 201
    if (result.skipped) res.status(HttpStatus.OK);
    return result;
  }

  @Post(':id/retry')
  @RequireScope('certs:issue')
  @ApiOperation({ summary: 'Retry a failed certificate issuance' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate retry initiated' })
  @ApiResponse({ status: 400, description: 'Certificate not in failed state' })
  @ApiResponse({
    status: 403,
    description: 'Viewers cannot retry certificates',
  })
  @ApiResponse({ status: 404, description: 'Certificate not found' })
  @Roles('owner', 'admin', 'member')
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  async retry(@Request() req: RequestWithUser, @Param('id') id: string) {
    await this.checkKeyAccess(req, +id);
    return this.tlsService.retry(+id, req.user.userId);
  }
}
