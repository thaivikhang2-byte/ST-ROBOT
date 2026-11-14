// ═══════════════════════════════════════════
// Pagination SDK — Paginated Result
// ═══════════════════════════════════════════

import { PaginationMeta } from '../response/api-response.dto';

export class PaginatedResult<T> {
  data: T[];
  meta: {
    pagination: PaginationMeta;
  };

  constructor(data: T[], total: number, page: number, limit: number) {
    const totalPages = Math.ceil(total / limit);

    this.data = data;
    this.meta = {
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
}
