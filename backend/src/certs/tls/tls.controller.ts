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
  ApiBody,
} from '@nestjs/swagger';
import { TlsService } from './tls.service';
import { ApiKeyAccessService } from '../../auth/access/api-key-access.service';
import { CreateTlsCrtDto } from './dto/create-tls-crt.dto';
import { UpdateTlsCrtDto } from './dto/update-tls-crt.dto';
import { RevokeTlsCrtDto } from './dto/revoke-tls-crt.dto';
import { RenewTlsCrtDto } from './dto/renew-tls-crt.dto';
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
    return this.tlsService.toResponses(
      await this.keyAccess.filterCerts(req.user, certs),
    );
  }

  @Post()
  @RequireScope('certs:issue')
  @ApiOperation({
    summary: 'Request a new TLS certificate',
    description:
      'Send `csrPem` to issue a certificate now (status `pending`). Or send ' +
      "`names` with `managedBy: 'connector'` to create a certificate a " +
      'connector will issue with its own key (status `awaiting_csr`); ' +
      'nothing is sent to the CA until the connector posts a CSR to ' +
      '`POST /certs/tls/:id/renew`. Exactly one of `csrPem` and `names`.',
  })
  @ApiResponse({
    status: 201,
    description:
      "Certificate request submitted: { id, status: 'pending' }, or " +
      "{ id, status: 'awaiting_csr' } for a request by names",
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid CSR or names, both or neither of csrPem and names, ' +
      "names without managedBy: 'connector', or a name outside the " +
      "account's verified domains",
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 402,
    description:
      'Plan limit reached (total active, monthly or concurrent pending ' +
      'certificates; requests by names skip the concurrent pending limit)',
  })
  @ApiResponse({
    status: 403,
    description:
      'Viewers cannot request certificates; API keys limited to certificates ' +
      'cannot request new ones, and keys limited to domains only for names under them',
  })
  @ApiResponse({
    status: 409,
    description:
      'An identical certificate request (same CSR, or same set of names) is already being processed. ' +
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
    return this.tlsService.toResponse(cert);
  }

  @Patch(':id')
  @RequireScope('certs:renew')
  @ApiOperation({ summary: 'Update a certificate' })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate updated' })
  @ApiResponse({
    status: 400,
    description:
      "Validation failed, for example managedBy not 'connector' or null",
  })
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
    return this.tlsService.toResponse(
      await this.tlsService.update(+id, req.user.userId, updateTlsCrtDto),
    );
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
  @ApiOperation({
    summary: 'Delete a failed, revoked or awaiting_csr certificate',
  })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiResponse({ status: 200, description: 'Certificate deleted' })
  @ApiResponse({
    status: 400,
    description: 'Certificate not in failed, revoked or awaiting_csr state',
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
  @ApiOperation({
    summary: 'Renew a certificate',
    description:
      'Queues a renewal. Without a body the CSR stored at first issuance is ' +
      'used again. With { csrPem } the certificate is renewed with that CSR ' +
      '(for example a new key) and it replaces the stored CSR. For an ' +
      '`awaiting_csr` certificate, { csrPem } is required and its names must ' +
      'equal `requestedNames`; the certificate is then issued like a new ' +
      "request (status 'pending'), and ifDue always treats it as due.",
  })
  @ApiParam({ name: 'id', description: 'Certificate ID' })
  @ApiQuery({
    name: 'ifDue',
    required: false,
    type: Boolean,
    description:
      'Only renew if the certificate is inside its renewal window ' +
      '(free: 5 days, paid: 30 days before expiry; at least 30 days for ' +
      'connector-managed certificates, which are due once their renewAfter ' +
      'has passed). Otherwise nothing is queued and the response has ' +
      'skipped: true. Default: false (always renew).',
  })
  @ApiBody({ type: RenewTlsCrtDto, required: false })
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
    description:
      'Certificate not issued or missing CSR data, invalid CSR, ' +
      "'CSR names must match the certificate', or 'This certificate is " +
      "waiting for a CSR' (awaiting_csr without csrPem)",
  })
  @ApiResponse({
    status: 409,
    description:
      'The awaiting_csr certificate was completed by another request meanwhile',
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
    @Body() body?: RenewTlsCrtDto,
  ) {
    await this.checkKeyAccess(req, +id);
    const result = await this.tlsService.renew(+id, req.user.userId, {
      ifDue: ifDue === 'true',
      csrPem: body?.csrPem,
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
