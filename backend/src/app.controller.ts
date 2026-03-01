import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RateLimitCategoryDecorator } from './throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from './throttler/interfaces/rate-limit-category.enum';

@Controller()
@ApiTags('Info')
@RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({
    summary: 'Get API info',
    description: 'Returns the current status and version of the API',
    responses: {
      200: {
        description: 'Server info retrieved successfully',
      },
    },
  })
  @Get()
  getInfo(): { status: string; version: string } {
    return this.appService.getInfo();
  }
}
