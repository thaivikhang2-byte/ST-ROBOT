import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles, Permissions, CurrentUser } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { UsersQueryDto, UserRoleDto, UserStatusDto } from './dto/users-query.dto';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('v1/users')
@Roles('admin', 'superadmin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('users:read')
  @ApiOperation({ summary: 'List all users (paginated)' })
  findAll(@Query() query: UsersQueryDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @Permissions('users:read')
  @ApiOperation({ summary: 'Get user by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @Permissions('users:create')
  @ApiOperation({ summary: 'Create a new user' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: RequestUser) {
    return this.usersService.create(dto, actor);
  }

  @Put(':id')
  @Permissions('users:update')
  @ApiOperation({ summary: 'Update user' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.usersService.update(id, dto, actor);
  }

  @Delete(':id')
  @Permissions('users:delete')
  @ApiOperation({ summary: 'Soft delete user' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.usersService.delete(id, actor);
  }

  @Patch(':id')
  @Permissions('users:update')
  @ApiOperation({
    summary: 'Partially update permitted user fields; security changes revoke sessions',
  })
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.usersService.update(id, dto, actor);
  }

  @Patch(':id/status')
  @Permissions('users:update')
  @ApiOperation({ summary: 'Change activation; cannot modify own or SuperAdmin activation' })
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UserStatusDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.usersService.update(id, dto, actor);
  }

  @Patch(':id/role')
  @Permissions('users:update')
  @ApiOperation({ summary: 'Assign an allowed role; revokes existing sessions' })
  role(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UserRoleDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.usersService.update(id, dto, actor);
  }
}
