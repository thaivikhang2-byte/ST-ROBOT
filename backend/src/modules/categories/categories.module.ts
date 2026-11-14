import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Permissions, Public, Roles } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';

@ApiTags('Categories')
@ApiBearerAuth('access-token')
@Controller('v1/categories')
class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}
  @Get()
  @Public()
  @ApiOperation({ summary: 'List active categories (up to 100)' })
  list() {
    return this.categories.list();
  }
  @Get('all')
  @Roles('admin', 'superadmin')
  @Permissions('categories:manage')
  @ApiOperation({ summary: 'List active and inactive categories for administration' })
  all() {
    return this.categories.list(true);
  }
  @Post()
  @Roles('admin', 'superadmin')
  @Permissions('categories:manage')
  @ApiOperation({ summary: 'Create a category' })
  create(@Body() dto: CreateCategoryDto, @CurrentUser() user: RequestUser) {
    return this.categories.create(dto, user.id);
  }
  @Patch(':id')
  @Roles('admin', 'superadmin')
  @Permissions('categories:manage')
  @ApiOperation({ summary: 'Update a category; published courses prevent retirement' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.categories.update(id, dto, user.id);
  }
  @Delete(':id')
  @Roles('admin', 'superadmin')
  @Permissions('categories:manage')
  @ApiOperation({ summary: 'Soft delete a category without deleting its courses' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.categories.update(id, {}, user.id, true);
  }
}

@Module({ controllers: [CategoriesController], providers: [CategoriesService] })
export class CategoriesModule {}
