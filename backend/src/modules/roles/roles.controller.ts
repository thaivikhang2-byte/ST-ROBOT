import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { PaginationQueryDto, Roles, Permissions, CurrentUser } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { CreateRoleDto, UpdateRoleDto, RolePermissionsDto } from './role.dto';

@ApiTags('Roles')
@ApiBearerAuth('access-token')
@Roles('admin', 'superadmin')
@Permissions('roles:manage')
@Controller('v1/roles')
export class RolesController {
  constructor(private readonly service: RolesService) {}
  @Get()
  @ApiOperation({ summary: 'List roles; admin/superadmin + roles:manage' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.service.findAll(query);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Role details and permission relationships' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }
  @Get(':id/permissions')
  @ApiOperation({ summary: 'Role permissions' })
  permissions(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.permissions(id);
  }
  @Post()
  @Roles('superadmin')
  @ApiOperation({ summary: 'Create custom role; superadmin only' })
  create(@Body() dto: CreateRoleDto, @CurrentUser() actor: RequestUser) {
    return this.service.create(dto, actor.id);
  }
  @Put(':id')
  @Roles('superadmin')
  @ApiOperation({ summary: 'Update custom role; built-ins immutable' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.update(id, dto, actor.id);
  }
  @Delete(':id')
  @Roles('superadmin')
  @ApiOperation({ summary: 'Delete unassigned custom role' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.service.delete(id, actor.id);
  }
  @Post(':id/permissions')
  @Roles('superadmin')
  @ApiOperation({ summary: 'Assign existing permissions idempotently; superadmin/guest immutable' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RolePermissionsDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.assignPermissions(id, dto.permissionIds, actor.id);
  }
  @Delete(':id/permissions/:permissionId')
  @Roles('superadmin')
  @ApiOperation({ summary: 'Remove permission; changes effective on next request' })
  unassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.assignPermissions(id, [permissionId], actor.id, true);
  }
}
