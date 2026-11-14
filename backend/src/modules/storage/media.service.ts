import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { PaginatedResult, RequestUser } from '../../shared/sdk';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../shared/sdk/errors/domain.exception';
import { LearningAccessService } from '../progress/learning-access.service';
import { auditContent, lockCourse } from '../courses/content-integrity';
import { InitiateMediaDto, MediaQueryDto } from './media.dto';
import { invalidMedia, mediaType, mediaLimit, verifyMedia } from './media-policy';
import { StorageService, storageUnavailable } from './storage.service';
import { assignedCourse, systemManager } from '../roles/authorization';

const include = {
  lesson_links: { include: { lesson: true } },
  video: { select: { id: true, provider: true } },
} satisfies Prisma.StorageObjectInclude;
type Asset = Prisma.StorageObjectGetPayload<{ include: typeof include }>;

@Injectable()
export class MediaService {
  private verifying = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: LearningAccessService,
  ) {}

  private async asset(id: string, tx: Prisma.TransactionClient = this.prisma) {
    const asset = await tx.storageObject.findUnique({ where: { id }, include });
    if (!asset || asset.deleted_at || !asset.lesson_links.length)
      throw new NotFoundException('Media', id);
    return asset;
  }
  private async lesson(id: string, tx: Prisma.TransactionClient = this.prisma) {
    const lesson = await tx.lesson.findFirst({ where: { id, deleted_at: null } });
    if (!lesson) throw new NotFoundException('Lesson', id);
    return lesson;
  }
  private async authorize(
    tx: Prisma.TransactionClient,
    actor: RequestUser,
    lessonId: string,
    permission = 'uploads:read',
  ) {
    const lesson = await this.lesson(lessonId, tx);
    const current = await this.access.actor(tx, actor);
    if (!current.permissions.includes(permission))
      throw new ForbiddenException('Current media permission required');
    const owner =
      current.permissions.includes('uploads:create') &&
      current.isEmailVerified &&
      (systemManager(current) ||
        assignedCourse({ ...current, requiredPermissions: [permission] }, lesson.course_id) ||
        (await tx.course.findUnique({ where: { id: lesson.course_id } }))?.creator_id ===
          current.id);
    if (permission !== 'uploads:read' && !owner)
      throw new ForbiddenException('Verified course author required');
    if (owner) await this.access.owner(current, lesson.course_id, tx);
    else await this.access.lesson(actor.id, lessonId, tx);
    return { lesson, owner };
  }
  private view(asset: Asset) {
    const link = asset.lesson_links[0];
    return {
      id: asset.id,
      lessonId: link.lesson_id,
      filename: asset.original_name,
      mimeType: asset.mime_type,
      sizeBytes: Number(asset.size),
      status: asset.status,
      resourceType: link.resource_type,
      sortOrder: link.sort_order,
      videoId: asset.video?.id ?? null,
      videoProvider: asset.video?.provider ?? null,
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
      scanStatus: asset.scan_status,
    };
  }
  async initiate(dto: InitiateMediaDto, actor: RequestUser) {
    this.storage.requireAvailable();
    const type = mediaType(dto.filename, dto.mimeType);
    if (dto.sizeBytes > mediaLimit(dto.mimeType, this.storage.settings.maxBytes))
      throw invalidMedia('File exceeds the configured upload limit');
    const lesson = await this.lesson(dto.lessonId);
    const id = randomUUID(),
      stagingKey = `incoming/${id}/${randomUUID()}`;
    const expiresAt = new Date(Date.now() + this.storage.settings.uploadTtl * 1000);
    const url = await this.storage.createUploadUrl(
      stagingKey,
      dto.sizeBytes,
      dto.mimeType,
      this.storage.settings.uploadTtl,
    );
    const asset = await this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, lesson.course_id);
      await this.authorize(tx, actor, dto.lessonId, 'uploads:create');
      const pending = await tx.storageObject.count({
        where: {
          uploaded_by: actor.id,
          status: { in: ['pending', 'uploading', 'verifying'] },
          upload_expires_at: { gt: new Date() },
        },
      });
      if (pending >= 10)
        throw new ConflictException('Finish or expire existing uploads before starting another');
      const asset = await tx.storageObject.create({
        data: {
          id,
          original_name: dto.filename,
          mime_type: dto.mimeType,
          size: dto.sizeBytes,
          checksum: dto.checksum,
          provider: this.storage.name,
          bucket: this.storage.settings.bucket,
          object_key: `media/${id}`,
          staging_key: stagingKey,
          uploaded_by: actor.id,
          status: 'uploading',
          upload_expires_at: expiresAt,
          lesson_links: {
            create: {
              lesson_id: dto.lessonId,
              resource_type: type,
              sort_order: dto.sortOrder ?? 0,
            },
          },
        },
        include,
      });
      await auditContent(tx, 'media.upload_initiated', actor.id, 'media', id);
      return asset;
    });
    return {
      ...this.view(asset),
      upload: {
        url,
        method: 'PUT',
        headers: { 'Content-Type': dto.mimeType, 'If-None-Match': '*' },
        expiresAt,
      },
    };
  }
  async complete(id: string, actor: RequestUser) {
    this.storage.requireAvailable();
    if (this.verifying >= 2)
      throw new ConflictException('Media verification capacity reached; retry shortly');
    this.verifying++;
    let claimed = false;
    try {
      const prior = await this.asset(id);
      this.storage.matches(prior.provider, prior.bucket);
      const asset = await this.prisma.$transaction(async (tx) => {
        await lockCourse(tx, prior.lesson_links[0].lesson.course_id);
        await this.authorize(tx, actor, prior.lesson_links[0].lesson_id, 'uploads:create');
        const current = await this.asset(id, tx);
        if (current.status === 'ready') return current;
        if (!current.upload_expires_at || current.upload_expires_at <= new Date())
          throw new ConflictException('Upload expired');
        const result = await tx.storageObject.updateMany({
          where: { id, status: { in: ['pending', 'uploading'] }, deleted_at: null },
          data: { status: 'verifying' },
        });
        if (!result.count)
          throw new ConflictException('Upload is already being verified or is unavailable');
        claimed = true;
        return current;
      });
      if (asset.status === 'ready') return this.view(asset);
      const metadata = await this.storage.getMetadata(asset.staging_key!);
      if (!metadata) {
        // Missing PUT can be retried until expiry. It is never treated as successful completion.
        await this.prisma.storageObject.updateMany({
          where: { id, status: 'verifying' },
          data: { status: 'uploading' },
        });
        claimed = false;
        throw new ConflictException('Uploaded object not found');
      }
      if (metadata.size !== Number(asset.size) || metadata.mimeType !== asset.mime_type)
        throw invalidMedia('Uploaded object metadata mismatch');
      const data = await this.storage.read(asset.staging_key!, Number(asset.size));
      verifyMedia(data, asset.mime_type, Number(asset.size), asset.checksum);
      await this.storage.upload(asset.object_key, data, asset.mime_type);
      const ready = await this.prisma.$transaction(async (tx) => {
        await lockCourse(tx, asset.lesson_links[0].lesson.course_id);
        await this.authorize(tx, actor, asset.lesson_links[0].lesson_id, 'uploads:create');
        const updated = await tx.storageObject.updateMany({
          where: { id, status: 'verifying', deleted_at: null },
          data: { status: 'ready' },
        });
        if (!updated.count) throw new ConflictException('Media is no longer available');
        if (asset.mime_type === 'video/mp4')
          await tx.video.create({
            data: {
              title: asset.original_name,
              lesson_id: asset.lesson_links[0].lesson_id,
              storage_key: asset.object_key,
              storage_object_id: id,
              status: 'ready',
              sort_order: asset.lesson_links[0].sort_order,
            },
          });
        await auditContent(tx, 'media.upload_completed', actor.id, 'media', id);
        return this.asset(id, tx);
      });
      return this.view(ready);
    } catch (error) {
      if (claimed)
        await this.prisma.$transaction(async (tx) => {
          const changed = await tx.storageObject.updateMany({
            where: { id, status: 'verifying' },
            data: { status: 'failed' },
          });
          if (changed.count) await auditContent(tx, 'media.upload_failed', actor.id, 'media', id);
        });
      throw error;
    } finally {
      this.verifying--;
    }
  }
  async list(query: MediaQueryDto, actor: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      const { owner } = await this.authorize(tx, actor, query.lessonId);
      const where: Prisma.LessonMediaWhereInput = {
        lesson_id: query.lessonId,
        asset: { deleted_at: null, ...(owner ? {} : { status: 'ready' }) },
      };
      const [rows, count] = await Promise.all([
        tx.lessonMedia.findMany({
          where,
          include: { asset: { include } },
          skip: query.skip,
          take: query.take,
          orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        }),
        tx.lessonMedia.count({ where }),
      ]);
      return new PaginatedResult(
        rows.map((row) => this.view(row.asset)),
        count,
        query.page,
        query.limit,
      );
    });
  }
  async get(id: string, actor: RequestUser) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.asset(id, tx);
      const { owner } = await this.authorize(tx, actor, asset.lesson_links[0].lesson_id);
      if (!owner && asset.status !== 'ready') throw new NotFoundException('Ready media', id);
      return this.view(asset);
    });
  }
  async download(id: string, actor: RequestUser) {
    const asset = await this.prisma.$transaction(async (tx) => {
      const asset = await this.asset(id, tx);
      await this.authorize(tx, actor, asset.lesson_links[0].lesson_id);
      if (asset.video && asset.video.provider !== 'legacy')
        throw new ForbiddenException('Use authorized HLS playback for processed videos');
      if (asset.status !== 'ready') throw new ConflictException('Media is not ready');
      return asset;
    });
    this.storage.matches(asset.provider, asset.bucket);
    const metadata = await this.storage.getMetadata(asset.object_key);
    if (!metadata || metadata.size !== Number(asset.size) || metadata.mimeType !== asset.mime_type)
      throw storageUnavailable();
    // Recheck after storage I/O. Signing uses local credentials and performs no network I/O.
    return this.prisma.$transaction(async (tx) => {
      const current = await this.asset(id, tx);
      await this.authorize(tx, actor, current.lesson_links[0].lesson_id);
      if (current.status !== 'ready') throw new ConflictException('Media is not ready');
      const ttl = this.storage.settings.downloadTtl;
      return {
        url: await this.storage.getSignedUrl(
          current.object_key,
          ttl,
          current.mime_type,
          current.original_name,
        ),
        expiresAt: new Date(Date.now() + ttl * 1000),
        mimeType: current.mime_type,
        filename: current.original_name,
        delivery: 'signed-s3',
        cacheControl: 'private, no-store',
      };
    });
  }
  async remove(id: string, actor: RequestUser) {
    const prior = await this.asset(id);
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, prior.lesson_links[0].lesson.course_id);
      await this.authorize(tx, actor, prior.lesson_links[0].lesson_id, 'uploads:delete');
      if (prior.video && prior.video.provider !== 'legacy')
        throw new ConflictException('Use video archive; processed source and history are retained');
      await this.asset(id, tx);
      await tx.storageObject.update({
        where: { id },
        data: { status: 'deleted', deleted_at: new Date() },
      });
      await tx.video.updateMany({
        where: { storage_object_id: id },
        data: { deleted_at: new Date(), status: 'failed' },
      });
      await auditContent(tx, 'media.deleted', actor.id, 'media', id);
      return { id, deleted: true };
    });
  }
  async video(id: string, actor: RequestUser, playback = false) {
    const video = await this.prisma.video.findFirst({ where: { id, deleted_at: null } });
    if (!video?.storage_object_id) throw new NotFoundException('Verified video', id);
    return playback
      ? this.download(video.storage_object_id, actor)
      : this.get(video.storage_object_id, actor);
  }
}
