import {
  Controller,
  Post,
  Patch,
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
import { UpdateOrgDto } from './dto/update-org.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
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

  /**
   * Update organization fields (e.g. name).
   * Caller must be owner or admin.
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Organization updated' })
  @Roles('owner', 'admin')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  update(
    @Param('id') orgId: string,
    @Request() req: RequestWithUser,
    @Body() dto: UpdateOrgDto,
  ) {
    return this.orgsService.update(orgId, req.user.userId, dto.name!);
  }

  /**
   * Delete the organization. Only the owner may do this.
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 204, description: 'Organization deleted' })
  @Roles('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  deleteOrg(@Param('id') orgId: string, @Request() req: RequestWithUser) {
    return this.orgsService.delete(orgId, req.user.userId);
  }

  /**
   * Transfer ownership to another member.
   * Only the current owner may call this.
   */
  @Post(':id/transfer-ownership')
  @ApiOperation({ summary: 'Transfer organization ownership' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 201, description: 'Ownership transferred' })
  @Roles('owner')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  transferOwnership(
    @Param('id') orgId: string,
    @Request() req: RequestWithUser,
    @Body() dto: TransferOwnershipDto,
  ) {
    return this.orgsService.transferOwnership(
      orgId,
      req.user.userId,
      dto.targetUserId,
    );
  }

  /**
   * Update a member's role. Cannot assign 'owner' — use transfer-ownership instead.
   * Caller must be owner or admin.
   */
  @Patch(':id/members/:userId')
  @ApiOperation({ summary: "Update a member's role" })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @Roles('owner', 'admin')
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  updateMemberRole(
    @Param('id') orgId: string,
    @Param('userId') targetUserId: string,
    @Request() req: RequestWithUser,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.orgsService.updateMemberRole(
      orgId,
      req.user.userId,
      targetUserId,
      dto.role,
    );
  }
}
