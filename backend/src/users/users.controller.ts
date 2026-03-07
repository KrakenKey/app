import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { AccountDeletionService } from './services/account-deletion.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { AdminGuard, isAdmin } from '../auth/guards/admin.guard';
import type { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';

@Controller('users')
@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'List all users (admin only)' })
  @ApiResponse({ status: 200, description: 'List of all users' })
  @ApiResponse({ status: 403, description: 'Admin access required' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID (own record or admin)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_READ)
  findOne(@Param('id') id: string, @Request() req: RequestWithUser) {
    if (req.user.userId !== id && !isAdmin(req.user)) {
      throw new ForbiddenException('You can only access your own record');
    }
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user (own record or admin)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: RequestWithUser,
  ) {
    if (req.user.userId !== id && !isAdmin(req.user)) {
      throw new ForbiddenException('You can only update your own record');
    }
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user account with cascade (own record or admin)' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User and all associated data deleted' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @RateLimitCategoryDecorator(RateLimitCategory.AUTHENTICATED_WRITE)
  remove(@Param('id') id: string, @Request() req: RequestWithUser) {
    if (req.user.userId !== id && !isAdmin(req.user)) {
      throw new ForbiddenException('You can only delete your own record');
    }
    return this.accountDeletionService.deleteAccount(id);
  }
}
