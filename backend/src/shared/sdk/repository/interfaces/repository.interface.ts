// ═══════════════════════════════════════════
// Repository SDK — Repository Interface
// Contract for all repositories
// ═══════════════════════════════════════════

import { PaginationQueryDto } from '../../pagination/pagination-query.dto';
import { PaginatedResult } from '../../pagination/paginated-result.dto';

export interface IRepository<T> {
  findById(id: string): Promise<T | null>;
  findAll(query: PaginationQueryDto): Promise<PaginatedResult<T>>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<T>;
  exists(id: string): Promise<boolean>;
  count(where?: Record<string, unknown>): Promise<number>;
}

export interface ISoftDeletableRepository<T> extends IRepository<T> {
  softDelete(id: string): Promise<T>;
  restore(id: string): Promise<T>;
  findWithDeleted(id: string): Promise<T | null>;
}
