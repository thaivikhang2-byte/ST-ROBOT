import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, PaginationQueryDto, Permissions } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { ProgressService } from './progress.service';
import { UpdateLearningProgressDto } from './learning.dto';

@ApiTags('Enrollments')
@ApiBearerAuth('access-token')
@Controller('v1/enrollments')
export class EnrollmentsController {
  constructor(private readonly progress: ProgressService) {}
  @Get()
  @Permissions('learning:read')
  @ApiOperation({
    summary: 'Page through own active enrollments and current required-lesson progress',
  })
  list(@CurrentUser() actor: RequestUser, @Query() query: PaginationQueryDto) {
    return this.progress.getMyEnrollments(actor.id, query);
  }
  @Get(':courseId')
  @Permissions('learning:read')
  @ApiOperation({ summary: 'Own enrollment state by course UUID, including cancellation history' })
  state(@CurrentUser() actor: RequestUser, @Param('courseId', ParseUUIDPipe) id: string) {
    return this.progress.enrollmentState(actor.id, id);
  }
  @Post(':courseId')
  @Permissions('learning:enroll')
  @ApiOperation({
    summary: 'Idempotently enroll or restore own enrollment; retain learning history',
  })
  enroll(@CurrentUser() actor: RequestUser, @Param('courseId', ParseUUIDPipe) id: string) {
    return this.progress.enroll(actor, id);
  }
  @Delete(':courseId')
  @Permissions('learning:enroll')
  @ApiOperation({ summary: 'Cancel own enrollment without deleting progress or attempts' })
  cancel(@CurrentUser() actor: RequestUser, @Param('courseId', ParseUUIDPipe) id: string) {
    return this.progress.unenroll(actor, id);
  }
}

@ApiTags('Learning')
@ApiBearerAuth('access-token')
@Controller('v1/learning')
export class LearningController {
  constructor(private readonly progress: ProgressService) {}
  @Get('courses/:courseId/progress')
  @Permissions('learning:read')
  @ApiOperation({ summary: 'Own course progress and resume lesson; active enrollment required' })
  course(@CurrentUser() actor: RequestUser, @Param('courseId', ParseUUIDPipe) id: string) {
    return this.progress.getCourseProgress(actor.id, id);
  }
  @Get('lessons/:lessonId/progress')
  @Permissions('learning:read')
  @ApiOperation({ summary: 'Own effective lesson progress with required-quiz gate' })
  lesson(@CurrentUser() actor: RequestUser, @Param('lessonId', ParseUUIDPipe) id: string) {
    return this.progress.lessonProgress(actor.id, id);
  }
  @Patch('lessons/:lessonId/progress')
  @Permissions('learning:update')
  @ApiOperation({
    summary: 'Validated monotonic own progress transition; server timestamps and quiz gate',
  })
  update(
    @CurrentUser() actor: RequestUser,
    @Param('lessonId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLearningProgressDto,
  ) {
    return this.progress.record(actor, id, dto.status === 'completed');
  }
  @Post('lessons/:lessonId/start')
  @Permissions('learning:update')
  @ApiOperation({ summary: 'Record server-side start/access time; never reset completed history' })
  start(@CurrentUser() actor: RequestUser, @Param('lessonId', ParseUUIDPipe) id: string) {
    return this.progress.record(actor, id, false);
  }
  @Post('lessons/:lessonId/complete')
  @Permissions('learning:update')
  @ApiOperation({
    summary: 'Complete own lesson after passing current required quizzes; no client scores',
  })
  complete(@CurrentUser() actor: RequestUser, @Param('lessonId', ParseUUIDPipe) id: string) {
    return this.progress.record(actor, id, true);
  }
}
