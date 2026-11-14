import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Patch,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LessonsService } from './lessons.service';
import { CreateLessonDto, UpdateLessonDto, ReorderLessonsDto } from './dto/lesson.dto';
import { PaginationQueryDto, Permissions, CurrentUser } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { UsePolicy } from '../../shared/sdk';
import {
  CourseEnrolledPolicy,
  LessonOwnerPolicy,
  LessonAccessPolicy,
} from '../courses/policies/course.policies';

@ApiTags('Lessons')
@ApiBearerAuth('access-token')
@Controller('v1/lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Get('course/:courseId')
  @Permissions('lessons:read')
  @UsePolicy(CourseEnrolledPolicy)
  @ApiOperation({ summary: 'List lessons by course' })
  findByCourse(
    @Param('courseId') courseId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.lessonsService.findByCourse(courseId, query, user);
  }

  @Get(':id')
  @Permissions('lessons:read')
  @UsePolicy(LessonAccessPolicy)
  @ApiOperation({ summary: 'Get lesson by ID with content' })
  findOne(@Param('id') id: string) {
    return this.lessonsService.findById(id);
  }

  @Post()
  @UsePolicy(LessonOwnerPolicy)
  @Permissions('lessons:create')
  @ApiOperation({ summary: 'Create a new lesson' })
  create(@Body() dto: CreateLessonDto, @CurrentUser() actor: RequestUser) {
    return this.lessonsService.create(dto, actor);
  }

  @Put(':id')
  @UsePolicy(LessonOwnerPolicy)
  @Permissions('lessons:update')
  @ApiOperation({ summary: 'Update lesson' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLessonDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.lessonsService.update(id, dto, actor);
  }

  @Delete(':id')
  @UsePolicy(LessonOwnerPolicy)
  @Permissions('lessons:delete')
  @ApiOperation({ summary: 'Soft delete lesson' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.lessonsService.delete(id, actor);
  }

  @Patch('course/:courseId/order')
  @Permissions('lessons:update')
  @ApiOperation({ summary: 'Atomically reorder every active lesson; owner or administrator only' })
  reorder(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: ReorderLessonsDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.lessonsService.reorder(courseId, dto, actor);
  }

  @Post(':id/complete')
  @Permissions('learning:update')
  @UsePolicy(LessonAccessPolicy)
  @ApiOperation({ summary: 'Mark lesson as completed' })
  markComplete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.lessonsService.markComplete(id, user);
  }
}
