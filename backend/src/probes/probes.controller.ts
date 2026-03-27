import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ServiceOrUserKeyGuard } from '../auth/guards/service-or-user-key.guard';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import { ProbesService } from './probes.service';
import { RegisterProbeDto } from './dto/register-probe.dto';
import { SubmitReportDto } from './dto/submit-report.dto';

@Controller('probes')
@ApiTags('Probes')
@ApiBearerAuth()
export class ProbesController {
  constructor(private readonly probesService: ProbesService) {}

  @Post('register')
  @UseGuards(ServiceOrUserKeyGuard)
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  register(@Request() req: any, @Body() dto: RegisterProbeDto) {
    return this.probesService.registerProbe(dto, req.user);
  }

  @Post('report')
  @UseGuards(ServiceOrUserKeyGuard)
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  report(@Request() req: any, @Body() dto: SubmitReportDto) {
    return this.probesService.submitReport(dto, req.user);
  }

  @Get(':probeId/config')
  @UseGuards(ServiceOrUserKeyGuard)
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  getConfig(@Request() req: any, @Param('probeId') probeId: string) {
    return this.probesService.getConfig(probeId, req.user);
  }
}
