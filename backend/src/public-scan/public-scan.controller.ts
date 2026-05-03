import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PublicScanService } from './public-scan.service';
import { PublicScanRequestDto } from './dto/public-scan.dto';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import type { PublicScanResponse } from '@krakenkey/shared';

@Controller('public-scan')
@ApiTags('Public Scan')
@RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
export class PublicScanController {
  constructor(private readonly publicScanService: PublicScanService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Scan a TLS endpoint (no auth required)' })
  @ApiResponse({ status: 200, description: 'Scan result' })
  @ApiResponse({
    status: 400,
    description: 'Invalid hostname or private address',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiResponse({ status: 503, description: 'Scanner unavailable' })
  scan(@Body() dto: PublicScanRequestDto): Promise<PublicScanResponse> {
    return this.publicScanService.scan(dto);
  }
}
