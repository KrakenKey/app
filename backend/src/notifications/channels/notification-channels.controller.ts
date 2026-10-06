import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtOrApiKeyGuard } from '../../auth/guards/jwt-or-api-key.guard';
import type { RequestWithUser } from '../../auth/interfaces/request-with-user.interface';
import { RequireScope } from '../../auth/decorators/require-scope.decorator';
import { RateLimitCategoryDecorator } from '../../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../../throttler/interfaces/rate-limit-category.enum';
import { hasResourceRestrictions } from '../../auth/api-key-restrictions';
import { NotificationChannelsService } from './notification-channels.service';
import {
  CreateNotificationChannelDto,
  UpdateNotificationChannelDto,
} from './dto/notification-channel.dto';

@Controller('notifications/channels')
@ApiTags('Notification channels')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
export class NotificationChannelsController {
  constructor(private readonly channels: NotificationChannelsService) {}

  /**
   * A channel receives alerts for every certificate, domain and endpoint on
   * the account, so a key limited to some of them must not manage channels.
   */
  private assertUnrestrictedKey(req: RequestWithUser): void {
    if (hasResourceRestrictions(req.user.apiKey)) {
      throw new ForbiddenException(
        'API keys limited to specific domains or certificates cannot manage notification channels.',
      );
    }
  }

  @Get()
  @RequireScope('account:read')
  @ApiOperation({ summary: 'List Slack, Teams and webhook channels' })
  @ApiResponse({ status: 200, description: 'Channels (URLs masked)' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  list(@Request() req: RequestWithUser) {
    return this.channels.list(req.user.userId);
  }

  @Post()
  @RequireScope('account:write')
  @ApiOperation({
    summary: 'Add a notification channel',
    description:
      'For webhook channels the response includes the signing secret. It is shown only once.',
  })
  @ApiResponse({ status: 201, description: 'Channel created' })
  @ApiResponse({
    status: 400,
    description: 'Invalid URL, unknown event or channel limit reached',
  })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  create(
    @Request() req: RequestWithUser,
    @Body() dto: CreateNotificationChannelDto,
  ) {
    this.assertUnrestrictedKey(req);
    return this.channels.create(req.user.userId, dto);
  }

  @Patch(':id')
  @RequireScope('account:write')
  @ApiOperation({ summary: 'Update a notification channel' })
  @ApiParam({ name: 'id', description: 'Channel UUID' })
  @ApiResponse({ status: 200, description: 'Channel updated' })
  @ApiResponse({ status: 404, description: 'Channel not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  update(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationChannelDto,
  ) {
    this.assertUnrestrictedKey(req);
    return this.channels.update(id, req.user.userId, dto);
  }

  @Delete(':id')
  @RequireScope('account:write')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a notification channel' })
  @ApiParam({ name: 'id', description: 'Channel UUID' })
  @ApiResponse({ status: 204, description: 'Channel deleted' })
  @ApiResponse({ status: 404, description: 'Channel not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  async remove(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    this.assertUnrestrictedKey(req);
    await this.channels.remove(id, req.user.userId);
  }

  @Post(':id/test')
  @RequireScope('account:write')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a test alert',
    description:
      'Sends a `test` event right away and reports what the destination answered.',
  })
  @ApiParam({ name: 'id', description: 'Channel UUID' })
  @ApiResponse({ status: 200, description: '{ ok, status, error }' })
  @ApiResponse({ status: 404, description: 'Channel not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
  test(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.assertUnrestrictedKey(req);
    return this.channels.test(id, req.user.userId);
  }

  @Post(':id/rotate-secret')
  @RequireScope('account:write')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate a webhook signing secret',
    description:
      'Returns the new secret once. The old secret stops working immediately.',
  })
  @ApiParam({ name: 'id', description: 'Channel UUID' })
  @ApiResponse({ status: 200, description: '{ secret }' })
  @ApiResponse({ status: 400, description: 'Not a webhook channel' })
  @ApiResponse({ status: 404, description: 'Channel not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  rotateSecret(
    @Request() req: RequestWithUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.assertUnrestrictedKey(req);
    return this.channels.rotateSecret(id, req.user.userId);
  }
}
