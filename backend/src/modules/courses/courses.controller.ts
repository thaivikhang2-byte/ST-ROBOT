import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CoursesService } from './courses.service';
import { CreateCourseDto, UpdateCourseDto, CourseQueryDto } from './dto/course.dto';
import { Permissions, CurrentUser, Public } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { Roles, UsePolicy } from '../../shared/sdk';
import { CourseOwnerPolicy, CourseReadPolicy } from './policies/course.policies';

@ApiTags('Courses')
@Controller('v1/courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List published courses (public)' })
  findPublished(@Query() query: CourseQueryDto) {
    return this.coursesService.findPublished(query);
  }

  @Get('all')
  @Roles('teacher', 'admin', 'superadmin')
  @ApiBearerAuth('access-token')
  @Permissions('courses:read')
  @ApiOperation({ summary: 'List all courses including drafts (admin/teacher)' })
  findAll(@Query() query: CourseQueryDto, @CurrentUser() user: RequestUser) {
    return this.coursesService.findAll(query, undefined, user);
  }

  @Public()
  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get course by slug (public)' })
  findBySlug(@Param('slug') slug: string) {
    return this.coursesService.findBySlug(slug);
  }

  @Get(':id')
  @Permissions('courses:read')
  @UsePolicy(CourseReadPolicy)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get course by ID' })
  findOne(@Param('id') id: string) {
    return this.coursesService.findById(id);
  }

  @Post()
  @ApiBearerAuth('access-token')
  @Permissions('courses:create')
  @ApiOperation({ summary: 'Create a new course' })
  create(@Body() dto: CreateCourseDto, @CurrentUser() user: RequestUser) {
    return this.coursesService.create(dto, user.id);
  }

  @Put(':id')
  @UsePolicy(CourseOwnerPolicy)
  @ApiBearerAuth('access-token')
  @Permissions('courses:update')
  @ApiOperation({ summary: 'Update course' })
  update(@Param('id') id: string, @Body() dto: UpdateCourseDto, @CurrentUser() user: RequestUser) {
    return this.coursesService.update(id, dto, user.id);
  }

  @Delete(':id')
  @UsePolicy(CourseOwnerPolicy)
  @ApiBearerAuth('access-token')
  @Permissions('courses:delete')
  @ApiOperation({ summary: 'Soft delete course' })
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.coursesService.delete(id, user.id);
  }
}
