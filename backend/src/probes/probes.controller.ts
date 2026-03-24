import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ServiceKeyGuard } from '../auth/guards/service-key.guard';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import { ProbesService } from './probes.service';
import { RegisterProbeDto } from './dto/register-probe.dto';
import { SubmitReportDto } from './dto/submit-report.dto';

@Controller('probes')
@ApiTags('Probes')
@ApiBearerAuth()
@UseGuards(ServiceKeyGuard)
export class ProbesController {
  constructor(private readonly probesService: ProbesService) {}

  @Post('register')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  register(@Body() dto: RegisterProbeDto) {
    return this.probesService.registerProbe(dto);
  }

  @Post('report')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  report(@Body() dto: SubmitReportDto) {
    return this.probesService.submitReport(dto);
  }

  @Get(':probeId/config')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  getConfig(@Param('probeId') probeId: string) {
    return this.probesService.getHostedConfig(probeId);
  }
}
