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
  Header,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiExtraModels,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiResponse,
} from '@nestjs/swagger';
import { QuizAttemptResponseDto, attemptResponseSchema } from './quiz-response.dto';
import { QuizzesService } from './quizzes.service';
import { CurrentUser, PaginationQueryDto, Permissions } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import {
  CreateQuizDto,
  UpdateQuizDto,
  QuizListDto,
  SubmitQuizDto,
  ManualGradeDto,
} from './quiz.dto';

@ApiTags('Quizzes')
@ApiExtraModels(QuizAttemptResponseDto)
@ApiResponse({ status: 400, description: 'Invalid DTO, options, keys or quiz settings' })
@ApiResponse({ status: 401, description: 'Active authenticated session required' })
@ApiResponse({
  status: 403,
  description: 'Permission, verified email, enrollment or ownership required',
})
@ApiResponse({ status: 409, description: 'Unavailable quiz, attempt limit or lifecycle conflict' })
@ApiResponse({ status: 429, description: 'Redis-backed request limit exceeded' })
@ApiBearerAuth('access-token')
@Controller('v1/quizzes')
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Get()
  @Permissions('quizzes:read')
  @ApiOperation({ summary: 'Published quizzes for an enrolled lesson; no answer keys' })
  findAll(@Query() query: QuizListDto, @CurrentUser() actor: RequestUser) {
    return this.quizzesService.findAll(query, actor);
  }

  @Get('author/list')
  @Header('Cache-Control', 'no-store')
  @Permissions('quizzes:update')
  @ApiOperation({
    summary: 'Paginated owner/administrator quiz metadata including drafts; no enrollment required',
  })
  authorList(@Query() query: QuizListDto, @CurrentUser() actor: RequestUser) {
    return this.quizzesService.findAll(query, actor, true);
  }

  @Get(':id')
  @Permissions('quizzes:read')
  @ApiOperation({ summary: 'Learner quiz projection; published and enrolled only' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.quizzesService.findById(id, actor);
  }

  @Get(':id/author')
  @Permissions('quizzes:update')
  @ApiOperation({
    summary: 'Author projection including answer keys; course owner or administrator only',
  })
  author(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.quizzesService.findById(id, actor, true);
  }

  @Post(':id/attempts')
  @ApiCreatedResponse({ schema: attemptResponseSchema })
  @Permissions('quizzes:attempt')
  @ApiOperation({ summary: 'Start or resume own active attempt; limits enforced atomically' })
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.quizzesService.start(id, actor);
  }

  @Get(':id/my-attempts')
  @Header('Cache-Control', 'no-store')
  @Permissions('quizzes:read')
  @ApiOperation({ summary: 'Own paginated score history; retained after enrollment cancellation' })
  history(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.quizzesService.myAttempts(id, actor, query);
  }

  @Post()
  @Permissions('quizzes:create')
  @ApiOperation({ summary: 'Create quizzes' })
  create(@Body() dto: CreateQuizDto, @CurrentUser() actor: RequestUser) {
    return this.quizzesService.create(dto, actor);
  }

  @Put(':id')
  @Permissions('quizzes:update')
  @ApiOperation({ summary: 'Update quizzes' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuizDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.quizzesService.update(id, dto, actor);
  }

  @Delete(':id')
  @Permissions('quizzes:delete')
  @ApiOperation({ summary: 'Delete quizzes' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.quizzesService.delete(id, actor);
  }
}

@ApiTags('Quiz attempts')
@ApiExtraModels(QuizAttemptResponseDto)
@ApiResponse({ status: 400, description: 'Invalid answer payload or manual grade' })
@ApiResponse({ status: 401, description: 'Active authenticated session required' })
@ApiResponse({
  status: 403,
  description: 'Own attempt, grading permission and course ownership enforced; no self grading',
})
@ApiResponse({
  status: 409,
  description: 'Expired, unavailable or differently resubmitted attempt',
})
@ApiResponse({ status: 429, description: 'Redis-backed request limit exceeded' })
@ApiBearerAuth('access-token')
@Controller('v1/quiz-attempts')
export class QuizAttemptsController {
  constructor(private readonly quizzes: QuizzesService) {}
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ schema: attemptResponseSchema })
  @Permissions('quizzes:read')
  @ApiOperation({ summary: 'Own attempt; deadline checked on read' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.quizzes.getAttempt(id, actor);
  }
  @Get(':id/result')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ schema: attemptResponseSchema })
  @Permissions('quizzes:read')
  @ApiOperation({
    summary: 'Own result; pending grades have null final score; keys follow captured review policy',
  })
  result(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.quizzes.getAttempt(id, actor);
  }
  @Post(':id/submit')
  @ApiCreatedResponse({ schema: attemptResponseSchema })
  @Permissions('quizzes:attempt')
  @ApiOperation({
    summary: 'Submit answers only; identical retries are idempotent, changed retries conflict',
  })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitQuizDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.quizzes.submit(id, dto, actor);
  }
  @Get(':id/grading')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ schema: attemptResponseSchema })
  @Permissions('quizzes:grade')
  @ApiOperation({
    summary: 'Course owner/administrator grading view with submitted work and rubric',
  })
  grading(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.quizzes.getAttempt(id, actor, true);
  }
  @Post(':id/grade')
  @ApiCreatedResponse({ schema: attemptResponseSchema })
  @Permissions('quizzes:grade')
  @ApiOperation({ summary: 'Audit manual grades; owner/administrator; self grading prohibited' })
  grade(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualGradeDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.quizzes.grade(id, dto, actor);
  }
}
