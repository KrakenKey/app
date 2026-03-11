import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';

@Controller('organizations')
@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  /**
   * Create a new organization. The caller becomes the owner.
   * Any authenticated user without an existing org may call this.
   */
  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({ status: 201, description: 'Organization created' })
  @ApiResponse({ status: 409, description: 'User already belongs to an org' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  create(@Request() req: RequestWithUser, @Body() dto: CreateOrgDto) {
    return this.orgsService.create(req.user.userId, dto.name);
  }

  /**
   * Get organization details including member list.
   * Only members of the org may call this.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get organization details' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Organization details' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  @Roles('owner', 'admin', 'member', 'viewer')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findOne(@Param('id') id: string) {
    return this.orgsService.findById(id);
  }

  /**
   * Invite a user to the organization.
   * Caller must be an owner or admin of the target org.
   */
  @Post(':id/members')
  @ApiOperation({ summary: 'Invite a user to the organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 201, description: 'Member invited' })
  @ApiResponse({ status: 404, description: 'Organization or user not found' })
  @ApiResponse({ status: 409, description: 'User already in another org' })
  @Roles('owner', 'admin')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  inviteMember(
    @Param('id') orgId: string,
    @Request() req: RequestWithUser,
    @Body() dto: InviteMemberDto,
  ) {
    return this.orgsService.inviteMember(
      orgId,
      req.user.userId,
      dto.userId,
      dto.role,
    );
  }

  /**
   * Remove a member from the organization.
   * Caller must be an owner or admin, or the member removing themselves.
   */
  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member from the organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiParam({ name: 'userId', description: 'User ID to remove' })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiResponse({ status: 400, description: 'Cannot remove the owner' })
  @ApiResponse({ status: 404, description: 'Member not found in org' })
  @Roles('owner', 'admin', 'member')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  removeMember(
    @Param('id') orgId: string,
    @Param('userId') targetUserId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.orgsService.removeMember(orgId, req.user.userId, targetUserId);
  }
}
