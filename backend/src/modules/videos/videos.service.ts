import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { ConfigType } from '@nestjs/config';
import { Queue } from 'bull';
import { Prisma, Video } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { videoConfig } from '../../config/configurations';
import { PrismaService } from '../../database/prisma.service';
import { RequestUser } from '../../shared/sdk';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  DomainException,
} from '../../shared/sdk/errors/domain.exception';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';
import { MediaService } from '../storage/media.service';
import { StorageService, storageUnavailable } from '../storage/storage.service';
import { LearningAccessService } from '../progress/learning-access.service';
import { assignedCourse, systemManager } from '../roles/authorization';
import { auditContent, lockCourse } from '../courses/content-integrity';
import { CloudflareStreamProvider } from './cloudflare-stream.provider';
import { VideoUploadDto, VideoMetadataDto, VideoProgressDto } from './video.dto';
import { safeHlsFile } from './video-provider';
import { SelfHostedHlsProvider } from './self-hosted-hls.provider';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = (message: string) => new DomainException(message, ErrorCode.VALIDATION_ERROR, 400);
@Injectable()
export class VideosService {
  constructor(
    private readonly media: MediaService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: LearningAccessService,
    private readonly cloud: CloudflareStreamProvider,
    private readonly local: SelfHostedHlsProvider,
    @Inject(videoConfig.KEY) readonly settings: ConfigType<typeof videoConfig>,
    @InjectQueue('video-processing') readonly queue: Queue,
  ) {}
  async operations(actor: RequestUser) {
    const current = await this.prisma.$transaction((tx) =>
      this.access.actor(tx, { ...actor, scopeCourseId: undefined }, 'uploads:read'),
    );
    if (!systemManager(current))
      throw new ForbiddenException('System video operations authority required');
    const tools = await Promise.all(
      [this.settings.ffmpeg, this.settings.ffprobe].map((binary) =>
        this.local.run(binary, ['-version'], undefined, 5000).then(
          () => true,
          () => false,
        ),
      ),
    );
    return {
      provider: this.settings.provider,
      localWorkerEnabled: this.settings.workerEnabled,
      ffmpegAvailable: tools[0],
      ffprobeAvailable: tools[1],
      queue: await this.queue.getJobCounts(),
      expiredLeases: await this.prisma.video.count({
        where: { status: 'processing', processing_lease: { lt: new Date() } },
      }),
      maxUploadBytes: this.settings.maxBytes,
      maxDurationSeconds: this.settings.maxDuration,
      processingTimeoutSeconds: this.settings.timeout,
      concurrencyPerProcess: 1,
      cloudLiveVerified: false,
    };
  }
  private async asset(id: string, tx: Prisma.TransactionClient = this.prisma) {
    const video = await tx.video.findFirst({ where: { id, deleted_at: null } });
    if (!video) throw new NotFoundException('Video', id);
    return video;
  }
  private async authorize(
    actor: RequestUser,
    lessonId: string,
    permission = 'uploads:read',
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const lesson = await tx.lesson.findFirst({ where: { id: lessonId, deleted_at: null } });
    if (!lesson) throw new NotFoundException('Lesson', lessonId);
    const current = await this.access.actor(tx, {
      ...actor,
      scopeCourseId: lesson.course_id,
      requiredPermissions: [permission],
    });
    if (!current.permissions.includes(permission))
      throw new ForbiddenException('Current video permission required');
    const course = await tx.course.findUniqueOrThrow({ where: { id: lesson.course_id } });
    const author =
      current.isEmailVerified &&
      current.permissions.includes('uploads:create') &&
      (systemManager(current) ||
        assignedCourse(current, course.id) ||
        course.creator_id === current.id);
    if (permission !== 'uploads:read' && !author)
      throw new ForbiddenException('Verified video author required');
    if (author) await this.access.owner(current, course.id, tx);
    else await this.access.lesson(current.id, lessonId, tx);
    return { lesson, author, current };
  }
  private view(v: Video, author = false) {
    return {
      id: v.id,
      lessonId: v.lesson_id,
      title: v.title,
      description: v.description,
      provider: v.provider,
      status: v.status,
      durationSeconds: v.duration_seconds,
      renditions: v.renditions,
      processingPercent: v.processing_percent,
      processingError: author ? v.processing_error : undefined,
      completionPercent: v.completion_percent,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
    };
  }
  async list(lessonId: string, actor: RequestUser) {
    const { author } = await this.prisma.$transaction((tx) =>
      this.authorize(actor, lessonId, 'uploads:read', tx),
    );
    const videos = await this.prisma.video.findMany({
      where: { lesson_id: lessonId, deleted_at: null, ...(author ? {} : { status: 'ready' }) },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      take: 100,
    });
    return videos.map((v) => this.view(v, author));
  }
  async findById(id: string, actor: RequestUser) {
    const video = await this.asset(id);
    if (video.provider === 'legacy') return this.media.video(id, actor);
    const { author } = await this.prisma.$transaction((tx) =>
      this.authorize(actor, video.lesson_id, 'uploads:read', tx),
    );
    return this.view(video, author);
  }
  async statistics(id: string, actor: RequestUser) {
    const v = await this.asset(id);
    const { author } = await this.prisma.$transaction((tx) =>
      this.authorize(actor, v.lesson_id, 'uploads:read', tx),
    );
    if (!author) throw new ForbiddenException('Video author statistics required');
    const source = v.storage_object_id
      ? await this.prisma.storageObject.findUnique({
          where: { id: v.storage_object_id },
          select: { size: true },
        })
      : null;
    return {
      videoId: id,
      viewers: await this.prisma.videoPlaybackProgress.count({ where: { video_id: id } }),
      completedTelemetry: await this.prisma.videoPlaybackProgress.count({
        where: { video_id: id, completed_at: { not: null } },
      }),
      sourceBytes: source ? Number(source.size) : null,
      processingAttempts: v.processing_attempts,
      processingLeaseUntil: v.processing_lease,
      deliveryBytes: null,
      deliveryMetrics: 'not_tracked',
    };
  }
  async initiate(dto: VideoUploadDto, actor: RequestUser) {
    await this.prisma.$transaction((tx) =>
      this.authorize(actor, dto.lessonId, 'uploads:create', tx),
    );
    if (dto.sizeBytes > this.settings.maxBytes || !/\.(mp4|mov)$/i.test(dto.filename))
      throw invalid('Video exceeds policy or has an unsupported filename');
    if (this.settings.provider === 'cloudflare' && dto.sizeBytes > 200000000)
      throw invalid(
        'Managed direct upload is limited to 200 MB; use the self-hosted provider for larger files',
      );
    const id = randomUUID(),
      objectId = randomUUID();
    let uid: string | undefined;
    let upload: { url: string; method: string; headers: Record<string, string>; expiresAt: Date };
    const expiry = new Date(Date.now() + 900000);
    const key = `incoming-video/${objectId}/${randomUUID()}`;
    if (this.settings.provider === 'cloudflare') {
      const result = await this.cloud.createUpload(this.settings.maxDuration);
      uid = result.uid;
      upload = { url: result.url, method: 'POST', headers: {}, expiresAt: expiry };
    } else {
      this.storage.requireAvailable();
      upload = {
        url: await this.storage.createUploadUrl(key, dto.sizeBytes, dto.mimeType, 900),
        method: 'PUT',
        headers: { 'Content-Type': dto.mimeType, 'If-None-Match': '*' },
        expiresAt: expiry,
      };
    }
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const { lesson } = await this.authorize(actor, dto.lessonId, 'uploads:create', tx);
        await lockCourse(tx, lesson.course_id);
        const pending = await tx.video.count({
          where: {
            lesson_id: dto.lessonId,
            deleted_at: null,
            status: { in: ['uploading', 'queued', 'processing'] },
          },
        });
        if (pending >= 5) throw new ConflictException('Finish existing video uploads first');
        const source =
          this.settings.provider === 'self-hosted'
            ? await tx.storageObject.create({
                data: {
                  id: objectId,
                  original_name: dto.filename,
                  mime_type: dto.mimeType,
                  size: dto.sizeBytes,
                  checksum: dto.checksum,
                  provider: this.storage.name,
                  bucket: this.storage.settings.bucket,
                  object_key: `video-source/${id}`,
                  staging_key: key,
                  status: 'uploading',
                  uploaded_by: actor.id,
                  upload_expires_at: expiry,
                  lesson_links: { create: { lesson_id: dto.lessonId, resource_type: 'video' } },
                },
              })
            : null;
        const v = await tx.video.create({
          data: {
            id,
            title: dto.filename,
            lesson_id: dto.lessonId,
            storage_key: source?.object_key ?? `cloudflare/${uid}`,
            storage_object_id: source?.id,
            provider: this.settings.provider,
            provider_uid: uid,
            status: 'uploading',
          },
        });
        await auditContent(tx, 'video.upload_initiated', actor.id, 'video', id);
        return v;
      });
      return { ...this.view(record, true), upload };
    } catch (error) {
      if (uid) await this.cloud.deleteVideo(uid).catch(() => undefined);
      throw error;
    }
  }
  async enqueue(id: string) {
    const old = await this.queue.getJob(`video-${id}`);
    if (old && (await old.getState()) === 'failed') await old.remove();
    await this.queue.add(
      'encode',
      { id },
      {
        jobId: `video-${id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 100,
        timeout: (this.settings.timeout + 180) * 1000,
      },
    );
  }
  async complete(id: string, actor: RequestUser) {
    const v = await this.asset(id);
    await this.prisma.$transaction((tx) =>
      this.authorize(actor, v.lesson_id, 'uploads:create', tx),
    );
    if (v.provider === 'legacy')
      throw new ConflictException('Use the original media completion endpoint');
    if (v.status !== 'uploading') return this.view(v, true);
    if (v.provider === 'cloudflare') {
      await this.syncCloud(v);
      return this.findById(id, actor);
    }
    const source = await this.prisma.storageObject.findUniqueOrThrow({
      where: { id: v.storage_object_id! },
    });
    this.storage.matches(source.provider, source.bucket);
    if (!source.upload_expires_at || source.upload_expires_at <= new Date())
      throw new ConflictException('Video upload session expired');
    const meta = await this.storage.getMetadata(source.staging_key!);
    if (!meta) throw new ConflictException('Source upload is missing');
    if (meta.size !== Number(source.size) || meta.mimeType !== source.mime_type)
      throw invalid('Source upload metadata mismatch');
    await this.prisma.$transaction(async (tx) => {
      await this.authorize(actor, v.lesson_id, 'uploads:create', tx);
      await tx.video.updateMany({
        where: { id, status: 'uploading', deleted_at: null },
        data: { status: 'queued' },
      });
      await tx.storageObject.updateMany({
        where: { id: source.id, status: 'uploading' },
        data: { status: 'verifying' },
      });
    });
    await this.enqueue(id);
    return this.findById(id, actor);
  }
  async retry(id: string, actor: RequestUser) {
    const v = await this.asset(id);
    await this.prisma.$transaction((tx) =>
      this.authorize(actor, v.lesson_id, 'uploads:create', tx),
    );
    if (v.provider !== 'self-hosted' || v.status !== 'failed')
      throw new ConflictException('Only failed local jobs can be retried');
    await this.prisma.video.updateMany({
      where: { id, status: 'failed', deleted_at: null },
      data: { status: 'queued', processing_attempts: 0, processing_error: null },
    });
    await this.enqueue(id);
    return this.findById(id, actor);
  }
  async syncCloud(v: Video) {
    if (!v.provider_uid || v.provider !== 'cloudflare') throw storageUnavailable();
    const state = await this.cloud.status(v.provider_uid);
    if (
      state.ready &&
      (!Number.isFinite(state.duration) ||
        state.duration <= 0 ||
        state.duration > this.settings.maxDuration)
    )
      throw storageUnavailable();
    await this.prisma.video.updateMany({
      where: { id: v.id, deleted_at: null, status: { notIn: ['archived', 'failed', 'ready'] } },
      data: {
        status: state.ready ? 'ready' : state.failed ? 'failed' : 'processing',
        processing_percent: state.ready ? 100 : state.percent,
        duration_seconds: state.ready ? Math.ceil(state.duration) : 0,
        source_width: state.width,
        source_height: state.height,
        processing_error: state.failed ? 'PROVIDER_ENCODING_FAILED' : null,
      },
    });
  }
  async status(id: string, actor: RequestUser) {
    const v = await this.asset(id);
    await this.prisma.$transaction((tx) => this.authorize(actor, v.lesson_id, 'uploads:read', tx));
    if (v.provider === 'cloudflare' && !['ready', 'failed', 'archived'].includes(v.status))
      await this.syncCloud(v);
    return this.findById(id, actor);
  }
  async metadata(id: string, dto: VideoMetadataDto, actor: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      const v = await this.asset(id, tx);
      await this.authorize(actor, v.lesson_id, 'uploads:create', tx);
      const updated = await tx.video.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          completion_percent: dto.completionPercent,
        },
      });
      await auditContent(tx, 'video.metadata_updated', actor.id, 'video', id);
      return this.view(updated, true);
    });
  }
  async archive(id: string, confirm: boolean, actor: RequestUser) {
    if (!confirm) throw invalid('Explicit archive confirmation is required');
    return this.prisma.$transaction(async (tx) => {
      const v = await this.asset(id, tx);
      await this.authorize(actor, v.lesson_id, 'uploads:delete', tx);
      await tx.video.update({
        where: { id },
        data: { status: 'archived', deleted_at: new Date() },
      });
      await auditContent(tx, 'video.archived', actor.id, 'video', id);
      return { id, archived: true, sourceRetained: true };
    });
  }
  async playback(id: string, actor: RequestUser) {
    const v = await this.asset(id);
    if (v.provider === 'legacy') return this.media.video(id, actor, true);
    await this.prisma.$transaction((tx) => this.authorize(actor, v.lesson_id, 'uploads:read', tx));
    if (v.status !== 'ready') throw new ConflictException('Video is not ready');
    const expiresAt = new Date(Date.now() + this.settings.playbackTtl * 1000);
    if (v.provider === 'cloudflare') {
      if (!(await this.cloud.status(v.provider_uid!)).ready)
        throw new ConflictException('Managed private video is not ready');
      const url = await this.cloud.playback(
        v.provider_uid!,
        Math.floor(expiresAt.getTime() / 1000),
      );
      await this.prisma.$transaction((tx) =>
        this.authorize(actor, v.lesson_id, 'uploads:read', tx),
      );
      return {
        url,
        expiresAt,
        mimeType: 'application/vnd.apple.mpegurl',
        delivery: 'cloudflare-signed',
        videoId: id,
      };
    }
    const secret = randomBytes(32).toString('hex');
    await this.prisma.$transaction(async (tx) => {
      await this.authorize(actor, v.lesson_id, 'uploads:read', tx);
      await tx.videoSession.create({
        data: {
          video_id: id,
          user_id: actor.id,
          auth_family_id: actor.sessionId,
          session_token: hash(secret),
          expires_at: expiresAt,
        },
      });
    });
    return {
      url: `${this.settings.publicApi}/api/v1/videos/${id}/hls/master.m3u8?token=${secret}`,
      expiresAt,
      mimeType: 'application/vnd.apple.mpegurl',
      delivery: 'private-hls',
      videoId: id,
    };
  }
  async purgeProvider(id: string, confirmVideoId: string, reason: string, actor: RequestUser) {
    if (confirmVideoId !== id) throw invalid('Confirm the exact archived video ID');
    const v = await this.prisma.$transaction(async (tx) => {
      const row = await tx.video.findUnique({ where: { id } });
      if (!row || !row.deleted_at || row.status !== 'archived' || row.provider !== 'cloudflare')
        throw new ConflictException('Only archived managed videos can be purged');
      const { current } = await this.authorize(actor, row.lesson_id, 'uploads:delete', tx);
      if (!systemManager(current))
        throw new ForbiddenException('System manager purge authority required');
      await tx.auditLog.create({
        data: {
          user_id: actor.id,
          action: 'video.provider_delete_requested',
          resource: 'video',
          resource_id: id,
          new_data: { reason },
        },
      });
      return row;
    });
    if (v.provider_uid) await this.cloud.deleteVideo(v.provider_uid);
    await this.prisma.$transaction(async (tx) => {
      await tx.video.updateMany({
        where: { id, status: 'archived', provider_uid: v.provider_uid },
        data: { provider_uid: null, processing_error: 'PROVIDER_DELETED' },
      });
      await auditContent(tx, 'video.provider_deleted', actor.id, 'video', id);
    });
    return { id, providerDeleted: true, historyRetained: true };
  }
  async delivery(id: string, file: string, secret: string) {
    if (!safeHlsFile(file) || !secret || !/^[a-f0-9]{64}$/.test(secret))
      throw new UnauthorizedException('Invalid playback grant');
    const session = await this.prisma.videoSession.findUnique({
      where: { session_token: hash(secret) },
    });
    if (
      !session ||
      session.video_id !== id ||
      session.expires_at <= new Date() ||
      !session.auth_family_id
    )
      throw new UnauthorizedException('Playback grant expired');
    const v = await this.asset(id);
    const actor: RequestUser = {
      id: session.user_id,
      email: '',
      roleId: '',
      roleName: '',
      permissions: [],
      isActive: false,
      isEmailVerified: false,
      sessionId: session.auth_family_id,
    };
    await this.prisma.$transaction((tx) => this.authorize(actor, v.lesson_id, 'uploads:read', tx));
    if (v.provider !== 'self-hosted' || v.status !== 'ready' || !v.hls_prefix)
      throw new NotFoundException('Ready HLS video');
    const source = await this.prisma.storageObject.findUniqueOrThrow({
      where: { id: v.storage_object_id! },
    });
    this.storage.matches(source.provider, source.bucket);
    if (source.deleted_at || source.status !== 'ready')
      throw new NotFoundException('Ready video source');
    if (file.endsWith('.m3u8')) {
      const body = (await this.storage.read(v.hls_prefix + '/' + file, 1048576)).toString('utf8');
      const lines = body.split(/\r?\n/).map((line) => {
        if (!line || line.startsWith('#')) {
          if (line.includes('URI=')) throw storageUnavailable();
          return line;
        }
        if (!safeHlsFile(line)) throw storageUnavailable();
        return `${line}?token=${secret}`;
      });
      return { manifest: lines.join('\n') };
    }
    const ttl = Math.max(
      1,
      Math.min(
        this.settings.segmentTtl,
        Math.floor((session.expires_at.getTime() - Date.now()) / 1000),
      ),
    );
    const url = await this.storage.getSignedUrl(v.hls_prefix + '/' + file, ttl, 'video/mp2t');
    return { url };
  }
  async progress(id: string, actor: RequestUser, dto?: VideoProgressDto) {
    return this.prisma.$transaction(async (tx) => {
      const v = await this.asset(id, tx);
      await this.authorize(actor, v.lesson_id, 'uploads:read', tx);
      if (v.status !== 'ready' || v.duration_seconds <= 0)
        throw new ConflictException('Video duration is not available');
      const where = { user_id_video_id: { user_id: actor.id, video_id: id } };
      let row = await tx.videoPlaybackProgress.upsert({
        where,
        create: { user_id: actor.id, video_id: id },
        update: {},
      });
      if (dto) {
        if (dto.positionSeconds > v.duration_seconds)
          throw invalid('Position exceeds server video duration');
        if (dto.version !== row.version)
          throw new ConflictException('Progress changed; reload the latest version');
        if (dto.positionSeconds !== row.position_seconds) {
          const elapsed = Math.floor((Date.now() - row.last_watched_at.getTime()) / 1000);
          const credit = Math.min(
            Math.max(0, dto.positionSeconds - row.position_seconds),
            Math.max(0, elapsed) * 2,
            30,
          );
          const watched = Math.min(v.duration_seconds, row.watched_seconds + credit);
          const completed = watched >= (v.duration_seconds * v.completion_percent) / 100;
          const changed = await tx.videoPlaybackProgress.updateMany({
            where: { id: row.id, version: dto.version },
            data: {
              position_seconds: dto.positionSeconds,
              furthest_seconds: Math.max(row.furthest_seconds, dto.positionSeconds),
              watched_seconds: watched,
              completed_at: row.completed_at ?? (completed ? new Date() : null),
              last_watched_at: new Date(),
              version: { increment: 1 },
            },
          });
          if (!changed.count) throw new ConflictException('Concurrent progress update');
          row = await tx.videoPlaybackProgress.findUniqueOrThrow({ where });
        }
      }
      return {
        videoId: id,
        positionSeconds: row.position_seconds,
        furthestSeconds: row.furthest_seconds,
        watchedSeconds: row.watched_seconds,
        durationSeconds: v.duration_seconds,
        completedAt: row.completed_at,
        lastWatchedAt: row.last_watched_at,
        version: row.version,
        lessonCompletion: 'unchanged',
      };
    });
  }
  async webhook(raw: Buffer, signature: string) {
    const digest = this.cloud.verifyWebhook(raw, signature);
    let payload: { uid?: string };
    try {
      payload = JSON.parse(raw.toString('utf8')) as typeof payload;
    } catch {
      throw invalid('Invalid webhook body');
    }
    const v = await this.prisma.video.findFirst({
      where: { provider: 'cloudflare', provider_uid: payload.uid || '', deleted_at: null },
    });
    if (!v) throw new NotFoundException('Managed video');
    // Signed payload is only a hint; fetch authoritative private/ready status from the provider.
    if (await this.prisma.videoWebhookReceipt.findUnique({ where: { digest } }))
      throw new ConflictException('Webhook replay');
    await this.syncCloud(v);
    try {
      await this.prisma.videoWebhookReceipt.create({ data: { digest, video_id: v.id } });
    } catch {
      throw new ConflictException('Webhook replay');
    }
    return { received: true };
  }
}
