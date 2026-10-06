import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService, type CsvExport } from './reports.service';

/**
 * Keys limited to specific domains or certificates are refused: a report can
 * name any host, so it would reach past the key's limits either way.
 */
export function assertUnrestrictedKey(req: RequestWithUser): void {
  const key = req.user.apiKey;
  if (key && (key.allowedDomainIds || key.allowedCertIds)) {
    throw new ForbiddenException(
      'This API key is limited to specific domains or certificates and cannot use reports.',
    );
  }
}

export function assertCsvFormat(format: string | undefined): void {
  if (format !== undefined && format !== 'csv') {
    throw new BadRequestException('Only format=csv is supported');
  }
}

export function sendCsv(res: Response, file: CsvExport): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.filename}"`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.data);
}

@Controller('reports')
@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @RequireScope('account:write')
  @ApiOperation({
    summary: 'Create a portfolio TLS report for a list of hosts',
    description:
      'Hosts are scanned in the background; poll GET /reports/:id until status is complete. Free plan: 25 hosts per report, paid plans: 250.',
  })
  @ApiResponse({ status: 201, description: 'Report created (pending)' })
  @ApiResponse({ status: 400, description: 'Invalid or private host' })
  @ApiResponse({ status: 403, description: 'Plan limit exceeded' })
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  create(@Request() req: RequestWithUser, @Body() dto: CreateReportDto) {
    assertUnrestrictedKey(req);
    return this.reportsService.create(req.user.userId, dto);
  }

  @Get()
  @RequireScope('account:read')
  @ApiOperation({ summary: 'List reports, newest first (summary only)' })
  @ApiResponse({ status: 200, description: 'Reports' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findAll(@Request() req: RequestWithUser) {
    assertUnrestrictedKey(req);
    return this.reportsService.findAll(req.user.userId);
  }

  @Get(':id')
  @RequireScope('account:read')
  @ApiOperation({ summary: 'Get a report with every host, most urgent first' })
  @ApiParam({ name: 'id', description: 'Report UUID' })
  @ApiResponse({ status: 200, description: 'Report' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findOne(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    assertUnrestrictedKey(req);
    return this.reportsService.findOne(id, req.user.userId);
  }

  @Get(':id/export')
  @RequireScope('account:read')
  @ApiOperation({ summary: 'Download a report as CSV' })
  @ApiParam({ name: 'id', description: 'Report UUID' })
  @ApiQuery({ name: 'format', required: false, enum: ['csv'] })
  @ApiResponse({ status: 200, description: 'CSV file' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  async export(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    assertUnrestrictedKey(req);
    assertCsvFormat(format);
    sendCsv(res, await this.reportsService.exportCsv(id, req.user.userId));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireScope('account:write')
  @ApiOperation({ summary: 'Delete a report and its share link' })
  @ApiParam({ name: 'id', description: 'Report UUID' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async remove(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    assertUnrestrictedKey(req);
    await this.reportsService.remove(id, req.user.userId);
  }

  @Post(':id/share')
  @RequireScope('account:write')
  @ApiOperation({
    summary: 'Create a read-only share link (replaces any existing link)',
    description:
      'The link works without login for 30 days. The token is returned once and only its hash is stored.',
  })
  @ApiParam({ name: 'id', description: 'Report UUID' })
  @ApiResponse({ status: 201, description: '{ url, token, expiresAt }' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  share(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    assertUnrestrictedKey(req);
    return this.reportsService.createShare(id, req.user.userId);
  }

  @Delete(':id/share')
  @HttpCode(204)
  @RequireScope('account:write')
  @ApiOperation({ summary: 'Revoke the share link' })
  @ApiParam({ name: 'id', description: 'Report UUID' })
  @ApiResponse({ status: 204, description: 'Revoked' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async revokeShare(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    assertUnrestrictedKey(req);
    await this.reportsService.revokeShare(id, req.user.userId);
  }
}
