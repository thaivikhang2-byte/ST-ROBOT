import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ConflictException, NotFoundException } from '../../shared/sdk/errors/domain.exception';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';
import { auditContent } from '../courses/content-integrity';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  list(all = false) {
    return this.prisma.category.findMany({
      where: { deleted_at: null, ...(!all ? { is_active: true } : {}) },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  }

  async create(dto: CreateCategoryDto, actorId: string) {
    if (!dto.name.trim()) throw new BadRequestException('Category name is required');
    return this.write(async (tx) => {
      const category = await tx.category.create({
        data: {
          name: dto.name.trim(),
          slug: dto.slug,
          description: dto.description,
          is_active: dto.isActive,
          sort_order: dto.sortOrder,
        },
      });
      await auditContent(tx, 'category.created', actorId, 'category', category.id);
      return category;
    });
  }

  async update(id: string, dto: UpdateCategoryDto, actorId: string, remove = false) {
    return this.write(async (tx) => {
      const locked = await tx.category.updateMany({
        where: { id, deleted_at: null },
        data: { sort_order: { increment: 0 } },
      });
      if (locked.count !== 1) throw new NotFoundException('Category', id);
      if (
        (remove || dto.isActive === false) &&
        (await tx.course.count({
          where: { category_id: id, deleted_at: null, status: 'published' },
        }))
      )
        throw new ConflictException('Unpublish assigned courses before retiring this category');
      if (dto.name !== undefined && !dto.name.trim())
        throw new BadRequestException('Category name is required');
      const category = await tx.category.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          slug: dto.slug,
          description: dto.description,
          is_active: remove ? false : dto.isActive,
          sort_order: dto.sortOrder,
          ...(remove ? { deleted_at: new Date() } : {}),
        },
      });
      await auditContent(
        tx,
        remove ? 'category.deleted' : 'category.updated',
        actorId,
        'category',
        id,
      );
      return category;
    });
  }

  private async write<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(callback);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Category slug already exists');
      throw error;
    }
  }
}
