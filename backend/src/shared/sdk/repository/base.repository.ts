// ═══════════════════════════════════════════
// Repository SDK — Base Repository
// Generic CRUD operations via Prisma
// ═══════════════════════════════════════════

import { PaginationQueryDto } from '../pagination/pagination-query.dto';
import { PaginatedResult } from '../pagination/paginated-result.dto';
import { buildPrismaQuery } from '../pagination/pagination.helper';

/**
 * Base repository providing standard CRUD operations.
 * Subclasses provide the Prisma delegate (e.g., prisma.user).
 *
 * Usage:
 * ```ts
 * class UsersRepository extends BaseRepository<User> {
 *   constructor(private prisma: PrismaService) {
 *     super(prisma, 'user');
 *   }
 * }
 * ```
 */
export abstract class BaseRepository<T extends Record<string, unknown>> {
  constructor(
    protected readonly prisma: any,
    protected readonly modelName: string,
  ) {}

  protected get model() {
    return this.prisma[this.modelName];
  }

  async findById(id: string): Promise<T | null> {
    return this.model.findUnique({
      where: { id, ...this.softDeleteFilter() },
    });
  }

  async findAll(
    query: PaginationQueryDto,
    where?: Record<string, unknown>,
  ): Promise<PaginatedResult<T>> {
    const prismaQuery = buildPrismaQuery(query);
    const effectiveWhere = { ...where, ...this.softDeleteFilter() };

    const [data, total] = await Promise.all([
      this.model.findMany({
        where: effectiveWhere,
        skip: prismaQuery.skip,
        take: prismaQuery.take,
        orderBy: prismaQuery.orderBy,
      }),
      this.model.count({ where: effectiveWhere }),
    ]);

    return new PaginatedResult<T>(data, total, query.page, query.limit);
  }

  async create(data: Partial<T>): Promise<T> {
    return this.model.create({ data });
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    return this.model.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<T> {
    return this.model.delete({
      where: { id },
    });
  }

  async softDelete(id: string): Promise<T> {
    return this.model.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
  }

  async restore(id: string): Promise<T> {
    return this.model.update({
      where: { id },
      data: { deleted_at: null },
    });
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.model.count({
      where: { id, ...this.softDeleteFilter() },
    });
    return count > 0;
  }

  async count(where?: Record<string, unknown>): Promise<number> {
    return this.model.count({
      where: { ...where, ...this.softDeleteFilter() },
    });
  }

  async findWithDeleted(id: string): Promise<T | null> {
    return this.model.findUnique({
      where: { id },
    });
  }

  /**
   * Override in subclass to enable soft-delete filtering.
   * Return {} (empty) if the model does NOT use soft delete.
   */
  protected softDeleteFilter(): Record<string, unknown> {
    return { deleted_at: null };
  }
}
