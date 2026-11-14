import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsString, IsUrl, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CurrentUser, PaginatedResult, PaginationQueryDto, Permissions } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { NotFoundException } from '../../shared/sdk/errors/domain.exception';
import { auditContent, lockCourse } from '../courses/content-integrity';
import { LearningAccessService } from './learning-access.service';

export class CreateLabDto {
  @ApiProperty() @IsUUID() lessonId!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(255) title!: string;
  @ApiProperty({ enum: ['tinkercad', 'vex', 'lego', 'other'] })
  @IsIn(['tinkercad', 'vex', 'lego', 'other'])
  platform!: string;
  @ApiProperty({ description: 'HTTPS external launch; backend never fetches this URL' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  url!: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(8000)
  instructions?: string;
}
export class SubmitPracticalDto {
  @ApiProperty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  projectUrl!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10000) notes!: string;
}
export class ReviewPracticalDto {
  @ApiProperty({ enum: ['completed', 'needs_revision'] })
  @IsIn(['completed', 'needs_revision'])
  status!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) feedback!: string;
}
function safeExternalUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new BadRequestException('Use an HTTPS URL without embedded credentials');
  return url.href;
}
const practicalSelect = {
  id: true,
  lab_id: true,
  user_id: true,
  project_url: true,
  notes: true,
  status: true,
  feedback: true,
  reviewed_at: true,
  reviewed_by: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.PracticalSubmissionSelect;
@Injectable()
export class LabsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LearningAccessService,
  ) {}
  async list(actor: RequestUser, lessonId: string) {
    await this.access.lesson(actor.id, lessonId);
    return this.prisma.labResource.findMany({
      where: { lesson_id: lessonId, deleted_at: null },
      select: {
        id: true,
        lesson_id: true,
        title: true,
        platform: true,
        url: true,
        embed_policy: true,
        instructions: true,
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });
  }
  async create(actor: RequestUser, dto: CreateLabDto) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: dto.lessonId, deleted_at: null },
    });
    if (!lesson) throw new NotFoundException('Lesson', dto.lessonId);
    const url = safeExternalUrl(dto.url);
    if (!dto.title.trim()) throw new BadRequestException('Title is required');
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, lesson.course_id);
      const current = await this.access.actor(tx, actor, 'labs:manage');
      await this.access.owner(current, lesson.course_id, tx);
      if (!(await tx.lesson.count({ where: { id: lesson.id, deleted_at: null } })))
        throw new NotFoundException('Lesson', lesson.id);
      const lab = await tx.labResource.create({
        data: {
          lesson_id: lesson.id,
          title: dto.title.trim(),
          platform: dto.platform,
          url,
          instructions: dto.instructions,
          embed_policy: 'external',
        },
      });
      await auditContent(tx, 'lab.created', actor.id, 'lab', lab.id);
      return lab;
    });
  }
  async submit(actor: RequestUser, labId: string, dto: SubmitPracticalDto) {
    const lab = await this.prisma.labResource.findFirst({
      where: { id: labId, deleted_at: null },
      include: { lesson: true },
    });
    if (!lab) throw new NotFoundException('Lab', labId);
    const projectUrl = safeExternalUrl(dto.projectUrl);
    if (!dto.notes.trim()) throw new BadRequestException('Submission notes are required');
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, lab.lesson.course_id);
      await this.access.actor(tx, actor, 'practicals:submit');
      await this.access.lesson(actor.id, lab.lesson_id, tx);
      if (!(await tx.labResource.count({ where: { id: labId, deleted_at: null } })))
        throw new NotFoundException('Lab', labId);
      const submission = await tx.practicalSubmission.create({
        data: {
          lab_id: labId,
          user_id: actor.id,
          project_url: projectUrl,
          notes: dto.notes.trim(),
        },
        select: practicalSelect,
      });
      await auditContent(tx, 'practical.submitted', actor.id, 'practical', submission.id);
      return submission;
    });
  }
  async mine(actor: RequestUser, query: PaginationQueryDto) {
    const where = { user_id: actor.id };
    const [rows, total] = await Promise.all([
      this.prisma.practicalSubmission.findMany({
        where,
        skip: query.skip,
        take: query.take,
        select: practicalSelect,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.practicalSubmission.count({ where }),
    ]);
    return new PaginatedResult(rows, total, query.page, query.limit);
  }
  async course(actor: RequestUser, courseId: string, query: PaginationQueryDto) {
    await this.access.owner(actor, courseId);
    const where = { lab: { lesson: { course_id: courseId } } };
    const [rows, total] = await Promise.all([
      this.prisma.practicalSubmission.findMany({
        where,
        skip: query.skip,
        take: query.take,
        select: practicalSelect,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.practicalSubmission.count({ where }),
    ]);
    return new PaginatedResult(rows, total, query.page, query.limit);
  }
  async review(actor: RequestUser, id: string, dto: ReviewPracticalDto) {
    const submission = await this.prisma.practicalSubmission.findUnique({
      where: { id },
      include: { lab: { include: { lesson: true } } },
    });
    if (!submission) throw new NotFoundException('Practical submission', id);
    if (!dto.feedback.trim()) throw new BadRequestException('Feedback is required');
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, submission.lab.lesson.course_id);
      const current = await this.access.actor(tx, actor, 'practicals:review');
      await this.access.owner(current, submission.lab.lesson.course_id, tx);
      if (submission.user_id === actor.id)
        throw new BadRequestException('Self review is prohibited');
      const reviewed = await tx.practicalSubmission.update({
        where: { id },
        data: {
          status: dto.status,
          feedback: dto.feedback.trim(),
          reviewed_by: actor.id,
          reviewed_at: new Date(),
        },
        select: practicalSelect,
      });
      await auditContent(tx, 'practical.reviewed', actor.id, 'practical', id);
      return reviewed;
    });
  }
}
@ApiTags('Learning labs and practical work')
@ApiBearerAuth('access-token')
@Controller('v1')
export class LabsController {
  constructor(private readonly labs: LabsService) {}
  @Get('learning/lessons/:id/labs')
  @Permissions('learning:read')
  @ApiOperation({ summary: 'Authorized external lab resources; no assumed iframe support' })
  list(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.labs.list(actor, id);
  }
  @Post('labs')
  @Permissions('labs:manage')
  @ApiOperation({ summary: 'Create lesson lab link; course owner/administrator only' })
  create(@CurrentUser() actor: RequestUser, @Body() dto: CreateLabDto) {
    return this.labs.create(actor, dto);
  }
  @Post('labs/:id/submissions')
  @Permissions('practicals:submit')
  @ApiOperation({
    summary: 'Persist own project link and reflection; no fabricated simulator grade',
  })
  submit(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitPracticalDto,
  ) {
    return this.labs.submit(actor, id, dto);
  }
  @Get('learning/submissions')
  @Permissions('learning:read')
  @ApiOperation({ summary: 'Own paginated practical submission and feedback history' })
  mine(@CurrentUser() actor: RequestUser, @Query() query: PaginationQueryDto) {
    return this.labs.mine(actor, query);
  }
  @Get('learning/courses/:id/submissions')
  @Permissions('practicals:review')
  @ApiOperation({ summary: 'Course owner/administrator practical work queue' })
  course(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.labs.course(actor, id, query);
  }
  @Put('practical-submissions/:id/review')
  @Permissions('practicals:review')
  @ApiOperation({ summary: 'Independent manual practical review with audit and feedback' })
  review(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPracticalDto,
  ) {
    return this.labs.review(actor, id, dto);
  }
}
