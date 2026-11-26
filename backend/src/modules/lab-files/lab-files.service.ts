import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma, LearnerLabFile } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { RequestUser } from '../../shared/sdk';
import { LearningAccessService } from '../progress/learning-access.service';
import { BeginLabFileUploadDto } from './lab-files.dto';
import { decodeLabFileChunk, LAB_FILE_LIMITS, LAB_UPLOAD_TTL_MS, LabFileScope, validateLabFileName, validateLabFileScope } from './lab-files.policy';

const metadata = (file: LearnerLabFile) => ({
  id: file.id, name: file.name, sizeBytes: file.size_bytes, createdAt: file.created_at.toISOString(),
});
const scopeWhere = (scope: LabFileScope) => ({
  course_slug: scope.courseId, lesson_slug: scope.lessonId, platform_key: scope.platformKey,
});

@Injectable()
export class LabFilesService {
  constructor(private readonly prisma: PrismaService, private readonly access: LearningAccessService) {}

  private async cleanup(tx: Prisma.TransactionClient, userId: string) {
    await tx.learnerLabFile.deleteMany({ where: { user_id: userId, status: 'uploading', upload_expires_at: { lte: new Date() } } });
  }

  private async usage(tx: Prisma.TransactionClient, userId: string) {
    const rows = await tx.learnerLabFile.groupBy({ by: ['status'], where: { user_id: userId },
      _sum: { size_bytes: true }, _count: { _all: true } });
    return {
      usedBytes: rows.find(row => row.status === 'ready')?._sum.size_bytes ?? 0,
      reservedBytes: rows.find(row => row.status === 'uploading')?._sum.size_bytes ?? 0,
      count: rows.reduce((sum, row) => sum + row._count._all, 0),
    };
  }

  async list(actor: RequestUser, scope: LabFileScope) {
    validateLabFileScope(scope);
    return this.prisma.$transaction(async tx => {
      await this.access.actor(tx, actor, 'learning:read');
      await this.cleanup(tx, actor.id);
      const [files, usage] = await Promise.all([
        tx.learnerLabFile.findMany({ where: { user_id: actor.id, ...scopeWhere(scope), status: 'ready' },
          orderBy: [{ created_at: 'desc' }, { id: 'asc' }], take: LAB_FILE_LIMITS.filesPerLab }),
        this.usage(tx, actor.id),
      ]);
      return { files: files.map(metadata), limits: LAB_FILE_LIMITS,
        usage: { usedBytes: usage.usedBytes, reservedBytes: usage.reservedBytes } };
    });
  }

  async begin(actor: RequestUser, dto: BeginLabFileUploadDto) {
    validateLabFileScope(dto); validateLabFileName(dto.name);
    if (!Number.isSafeInteger(dto.sizeBytes) || dto.sizeBytes < 0 || dto.sizeBytes > LAB_FILE_LIMITS.fileBytes)
      throw new PayloadTooLargeException('Mỗi tệp được lưu tối đa 25 MiB.');
    return this.prisma.$transaction(async tx => {
      await this.access.actor(tx, actor, 'learning:update');
      await this.cleanup(tx, actor.id);
      let file = await tx.learnerLabFile.findUnique({ where: { user_id_client_upload_id: { user_id: actor.id, client_upload_id: dto.clientUploadId } } });
      if (file) {
        if (file.name !== dto.name || file.size_bytes !== dto.sizeBytes || file.course_slug !== dto.courseId
            || file.lesson_slug !== dto.lessonId || file.platform_key !== dto.platformKey)
          throw new ConflictException('Lượt tải lên đã được dùng cho một tệp khác. Hãy chọn tệp lại.');
      } else {
        const usage = await this.usage(tx, actor.id);
        if (usage.usedBytes + usage.reservedBytes + dto.sizeBytes > LAB_FILE_LIMITS.accountBytes)
          throw new PayloadTooLargeException('Tài khoản đã dùng hết 250 MiB lưu tệp. Hãy xóa tệp không còn cần trước khi thêm.');
        if (usage.count >= LAB_FILE_LIMITS.filesPerAccount)
          throw new PayloadTooLargeException('Mỗi tài khoản lưu tối đa 500 tệp. Hãy xóa tệp không còn cần trước khi thêm.');
        const scopeCount = await tx.learnerLabFile.count({ where: { user_id: actor.id, ...scopeWhere(dto) } });
        if (scopeCount >= LAB_FILE_LIMITS.filesPerLab)
          throw new PayloadTooLargeException('Mỗi bài trên một nền tảng lưu tối đa 50 tệp.');
        file = await tx.learnerLabFile.create({ data: {
          user_id: actor.id, ...scopeWhere(dto), name: dto.name, size_bytes: dto.sizeBytes,
          chunk_count: Math.ceil(dto.sizeBytes / LAB_FILE_LIMITS.chunkBytes), client_upload_id: dto.clientUploadId,
          upload_expires_at: new Date(Date.now() + LAB_UPLOAD_TTL_MS),
        } });
      }
      return { id: file.id, chunkBytes: LAB_FILE_LIMITS.chunkBytes, chunkCount: file.chunk_count,
        expiresAt: file.upload_expires_at?.toISOString() ?? null };
    });
  }

  private async owned(tx: Prisma.TransactionClient, actor: RequestUser, id: string) {
    const file = await tx.learnerLabFile.findFirst({ where: { id, user_id: actor.id } });
    if (!file) throw new NotFoundException('Không tìm thấy tệp trong tài khoản của bạn.');
    return file;
  }

  private currentUpload(file: LearnerLabFile) {
    if (file.status === 'uploading' && (!file.upload_expires_at || file.upload_expires_at <= new Date()))
      throw new GoneException('Lượt tải tệp đã hết hạn. Hãy chọn tệp và tải lên lại.');
  }

  private chunkSize(file: LearnerLabFile, index: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= file.chunk_count)
      throw new BadRequestException('Phần tệp được yêu cầu không hợp lệ.');
    return Math.min(LAB_FILE_LIMITS.chunkBytes, file.size_bytes - index * LAB_FILE_LIMITS.chunkBytes);
  }

  async putChunk(actor: RequestUser, id: string, index: number, encoded: unknown) {
    const bytes = decodeLabFileChunk(encoded);
    return this.prisma.$transaction(async tx => {
      await this.access.actor(tx, actor, 'learning:update');
      const file = await this.owned(tx, actor, id); this.currentUpload(file);
      if (this.chunkSize(file, index) !== bytes.length) throw new BadRequestException('Dung lượng phần tệp không khớp với tệp đã chọn.');
      const previous = await tx.learnerLabFileChunk.findUnique({ where: { file_id_chunk_index: { file_id: file.id, chunk_index: index } } });
      if (previous) {
        if (!Buffer.from(previous.data).equals(bytes)) throw new ConflictException('Phần tệp này đã được lưu với nội dung khác. Hãy chọn tệp lại.');
      } else {
        if (file.status !== 'uploading') throw new ConflictException('Tệp đã lưu không thể thay đổi từng phần.');
        await tx.learnerLabFileChunk.create({ data: { file_id: file.id, chunk_index: index, size_bytes: bytes.length, data: bytes } });
      }
      return { id: file.id, index, sizeBytes: bytes.length };
    });
  }

  async getChunk(actor: RequestUser, id: string, index: number) {
    return this.prisma.$transaction(async tx => {
      await this.access.actor(tx, actor, 'learning:read');
      const file = await this.owned(tx, actor, id);
      if (file.status !== 'ready') throw new NotFoundException('Tệp chưa được tải lên đầy đủ.');
      this.chunkSize(file, index);
      const chunk = await tx.learnerLabFileChunk.findUnique({ where: { file_id_chunk_index: { file_id: file.id, chunk_index: index } } });
      if (!chunk) throw new NotFoundException('Không tìm thấy dữ liệu của tệp.');
      return { dataBase64: Buffer.from(chunk.data).toString('base64'), index };
    });
  }

  async complete(actor: RequestUser, id: string) {
    return this.prisma.$transaction(async tx => {
      await this.access.actor(tx, actor, 'learning:update');
      const file = await this.owned(tx, actor, id); this.currentUpload(file);
      if (file.status === 'ready') return metadata(file);
      const chunks = await tx.learnerLabFileChunk.aggregate({ where: { file_id: file.id }, _count: { _all: true }, _sum: { size_bytes: true } });
      if (chunks._count._all !== file.chunk_count || (chunks._sum.size_bytes ?? 0) !== file.size_bytes)
        throw new ConflictException('Tệp chưa tải lên đủ. Hãy thử lại trước khi rời trang.');
      const saved = await tx.learnerLabFile.update({ where: { id: file.id }, data: { status: 'ready', upload_expires_at: null } });
      await tx.auditLog.create({ data: { user_id: actor.id, action: 'learner.file_saved', resource: 'learner_lab_file',
        resource_id: file.id, new_data: { sizeBytes: file.size_bytes } } });
      return metadata(saved);
    });
  }

  async remove(actor: RequestUser, id: string) {
    return this.prisma.$transaction(async tx => {
      await this.access.actor(tx, actor, 'learning:update');
      const file = await this.owned(tx, actor, id);
      await tx.learnerLabFile.delete({ where: { id: file.id } });
      await tx.auditLog.create({ data: { user_id: actor.id, action: 'learner.file_deleted', resource: 'learner_lab_file', resource_id: file.id } });
      return { success: true };
    });
  }
}
