import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProduces, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { VideosService } from './videos.service';
import { CurrentUser, Permissions, Public, RequestUser, Roles } from '../../shared/sdk';
import { ForbiddenException } from '../../shared/sdk/errors/domain.exception';
import {
  VideoUploadDto,
  VideoQueryDto,
  VideoMetadataDto,
  VideoProgressDto,
  ArchiveVideoDto,
  PurgeProviderVideoDto,
} from './video.dto';

@ApiTags('Videos')
@ApiBearerAuth('access-token')
@Controller('v1/videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}
  @Get()
  @Permissions('uploads:read')
  @ApiOperation({ summary: 'List up to 100 lesson videos; owners see processing state' })
  list(@Query() query: VideoQueryDto, @CurrentUser() actor: RequestUser) {
    return this.videosService.list(query.lessonId, actor);
  }
  @Get('operations')
  @Roles('admin', 'superadmin')
  @Permissions('uploads:read')
  @ApiOperation({
    summary:
      'System-manager-only local tools, queue, lease recovery and configured media limits; no credentials',
  })
  operations(@CurrentUser() actor: RequestUser) {
    return this.videosService.operations(actor);
  }
  @Post('uploads')
  @Permissions('uploads:create')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Authorize direct video upload; local PUT or optional managed multipart POST',
  })
  initiate(@Body() dto: VideoUploadDto, @CurrentUser() actor: RequestUser) {
    return this.videosService.initiate(dto, actor);
  }
  @Public()
  @Post('webhooks/cloudflare')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    security: [],
    summary:
      'Verify raw-body Cloudflare HMAC/timestamp/replay; synchronize authoritative provider status',
  })
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('webhook-signature') signature: string) {
    if (!req.rawBody) throw new ForbiddenException('Raw webhook body required');
    return this.videosService.webhook(req.rawBody, signature || '');
  }
  @Get(':id')
  @Permissions('uploads:read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Video metadata; current enrollment or verified author required' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.videosService.findById(id, actor);
  }
  @Get(':id/status')
  @Permissions('uploads:read')
  @ApiOperation({ summary: 'Processing status; managed state is fetched from the provider' })
  status(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.videosService.status(id, actor);
  }
  @Get(':id/statistics')
  @Permissions('uploads:read')
  @ApiOperation({
    summary:
      'Scoped author-only actual progress/source statistics; untracked delivery metrics are null',
  })
  statistics(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.videosService.statistics(id, actor);
  }
  @Post(':id/complete-upload')
  @Permissions('uploads:create')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Verify source metadata and enqueue processing; never trusts client readiness',
  })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.videosService.complete(id, actor);
  }
  @Post(':id/retry')
  @Permissions('uploads:create')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({
    summary: 'Explicit retry of a failed local encoding job; bounded to three attempts',
  })
  retry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.videosService.retry(id, actor);
  }
  @Patch(':id')
  @Permissions('uploads:create')
  @ApiOperation({
    summary:
      'Update title/description and telemetry completion threshold; does not change lesson completion',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VideoMetadataDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.videosService.metadata(id, dto, actor);
  }
  @Delete(':id')
  @Permissions('uploads:delete')
  @ApiOperation({
    summary: 'Archive with explicit confirmation; preserve source and historical progress',
  })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveVideoDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.videosService.archive(id, dto.confirm, actor);
  }
  @Post(':id/playback')
  @Permissions('uploads:read')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Short-lived private HLS grant; legacy verified MP4 contract preserved',
  })
  playback(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.videosService.playback(id, actor);
  }
  @Post(':id/purge-provider')
  @Roles('admin', 'superadmin')
  @Permissions('uploads:delete')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({
    summary:
      'Irreversible deletion of an already archived managed asset; exact ID/reason required, history retained',
  })
  purgeProvider(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurgeProviderVideoDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.videosService.purgeProvider(id, dto.confirmVideoId, dto.reason, actor);
  }
  @Get(':id/progress')
  @Permissions('uploads:read')
  @ApiOperation({ summary: 'Current-user resume record and optimistic version; server duration' })
  progress(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.videosService.progress(id, actor);
  }
  @Post(':id/progress')
  @Permissions('uploads:read')
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @ApiOperation({
    summary:
      'Versioned resume update; bounded position and elapsed-time credit, no competency claim',
  })
  saveProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VideoProgressDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.videosService.progress(id, actor, dto);
  }
  @Public()
  @Get(':id/hls/:file')
  @Throttle({ default: { limit: 240, ttl: 60000 } })
  @ApiProduces('application/vnd.apple.mpegurl')
  @ApiQuery({ name: 'token', required: true })
  @ApiOperation({
    security: [{ 'video-playback': [] }],
    summary:
      'Capability-authenticated HLS origin; rechecks current account/session/enrollment for every manifest or segment redirect',
  })
  async hls(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('file') file: string,
    @Query('token') token: string,
    @Res() response: Response,
  ) {
    const result = await this.videosService.delivery(id, file, token);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (result.manifest !== undefined) {
      response.type('application/vnd.apple.mpegurl').send(result.manifest);
      return;
    }
    response.redirect(302, result.url);
  }
}
