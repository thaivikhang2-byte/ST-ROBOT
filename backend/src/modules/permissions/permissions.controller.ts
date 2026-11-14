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
import { PermissionsService } from './permissions.service';
import { PaginationQueryDto, Roles, Permissions, CurrentUser } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { CreatePermissionDto, UpdatePermissionDto } from './permission.dto';
@ApiTags('Permissions')
@ApiBearerAuth('access-token')
@Roles('admin', 'superadmin')
@Permissions('permissions:manage')
@Controller('v1/permissions')
export class PermissionsController {
  constructor(private readonly service: PermissionsService) {}
  @Get()
  @ApiOperation({ summary: 'List permissions; admin/superadmin + permissions:manage' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.service.findAll(query);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get permission by UUID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }
  @Post()
  @Roles('superadmin')
  @ApiOperation({ summary: 'Create custom permission; superadmin only' })
  create(@Body() dto: CreatePermissionDto, @CurrentUser() actor: RequestUser) {
    return this.service.create(dto, actor.id);
  }
  @Put(':id')
  @Roles('superadmin')
  @ApiOperation({ summary: 'Update unused custom permission' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermissionDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.update(id, dto, actor.id);
  }
  @Delete(':id')
  @Roles('superadmin')
  @ApiOperation({ summary: 'Delete unused custom permission; built-ins protected' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.service.delete(id, actor.id);
  }
}
