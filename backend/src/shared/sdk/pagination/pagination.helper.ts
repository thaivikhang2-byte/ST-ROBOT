// ═══════════════════════════════════════════
// Pagination SDK — Helper
// Build Prisma-compatible query args
// ═══════════════════════════════════════════

import { PaginationQueryDto } from './pagination-query.dto';

export interface PrismaQueryArgs {
  skip: number;
  take: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

/**
 * Convert PaginationQueryDto to Prisma-compatible query args.
 * @param query - Pagination query DTO
 * @param defaultSort - Default sort field (e.g., 'createdAt')
 */
export function buildPrismaQuery(
  query: PaginationQueryDto,
  defaultSort = 'created_at',
): PrismaQueryArgs {
  const args: PrismaQueryArgs = {
    skip: query.skip,
    take: query.take,
  };

  const sortField = query.sort || defaultSort;
  args.orderBy = { [sortField]: query.order };

  return args;
}
