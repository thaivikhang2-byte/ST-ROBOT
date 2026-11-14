import { Controller, Post, Delete, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProgressService } from './progress.service';
import { CurrentUser, PaginationQueryDto, Permissions } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';

@ApiTags('Progress')
@ApiBearerAuth('access-token')
@Controller('v1/progress')
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Post('enroll/:courseId')
  @Permissions('learning:enroll')
  @ApiOperation({ summary: 'Enroll in a course' })
  enroll(@Param('courseId', ParseUUIDPipe) courseId: string, @CurrentUser() user: RequestUser) {
    return this.progressService.enroll(user, courseId);
  }

  @Delete('enroll/:courseId')
  @Permissions('learning:enroll')
  @ApiOperation({ summary: 'Unenroll from a course' })
  unenroll(@Param('courseId', ParseUUIDPipe) courseId: string, @CurrentUser() user: RequestUser) {
    return this.progressService.unenroll(user, courseId);
  }

  @Get('my-courses')
  @Permissions('learning:read')
  @ApiOperation({ summary: 'Get my enrolled courses with progress' })
  getMyEnrollments(@CurrentUser() user: RequestUser, @Query() query: PaginationQueryDto) {
    return this.progressService.getMyEnrollments(user.id, query);
  }

  @Get('course/:courseId')
  @Permissions('learning:read')
  @ApiOperation({ summary: 'Get lesson-by-lesson progress for a course' })
  getCourseProgress(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.progressService.getCourseProgress(user.id, courseId);
  }
}
