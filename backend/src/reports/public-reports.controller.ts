import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { PublicReport } from '@krakenkey/shared';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import { ReportsService } from './reports.service';
import { assertCsvFormat, sendCsv } from './reports.controller';

/**
 * Shared reports, reachable without login through the share token. Rate
 * limited per IP like the other public routes, never cached, and kept out of
 * search engines.
 */
@Controller('public/reports')
@ApiTags('Reports')
@RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
export class PublicReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  private static privateHeaders(res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }

  @Get(':token')
  @ApiOperation({ summary: 'View a shared report (no auth required)' })
  @ApiParam({ name: 'token', description: 'Share token from the link' })
  @ApiResponse({ status: 200, description: 'Report contents' })
  @ApiResponse({
    status: 404,
    description: 'Unknown, revoked or expired link',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async findShared(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicReport> {
    PublicReportsController.privateHeaders(res);
    return this.reportsService.findShared(token);
  }

  @Get(':token/export')
  @ApiOperation({ summary: 'Download a shared report as CSV (no auth)' })
  @ApiParam({ name: 'token', description: 'Share token from the link' })
  @ApiQuery({ name: 'format', required: false, enum: ['csv'] })
  @ApiResponse({ status: 200, description: 'CSV file' })
  @ApiResponse({
    status: 404,
    description: 'Unknown, revoked or expired link',
  })
  async exportShared(
    @Param('token') token: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    assertCsvFormat(format);
    const file = await this.reportsService.exportSharedCsv(token);
    PublicReportsController.privateHeaders(res);
    sendCsv(res, file);
  }
}
