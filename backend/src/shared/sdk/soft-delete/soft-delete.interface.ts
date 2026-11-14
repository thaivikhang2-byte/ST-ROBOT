// ═══════════════════════════════════════════
// Soft Delete SDK — Interface & Helpers
// ═══════════════════════════════════════════

/**
 * Interface for entities that support soft delete.
 * Entities must have a `deleted_at` column.
 */
export interface ISoftDeletable {
  deleted_at: Date | null;
}

/**
 * Filter to exclude soft-deleted records in Prisma queries.
 */
export const SOFT_DELETE_FILTER = { deleted_at: null };

/**
 * Check if an entity has been soft-deleted.
 */
export function isSoftDeleted(entity: ISoftDeletable): boolean {
  return entity.deleted_at !== null;
}

/**
 * Entities that use soft delete.
 * Used by retention service and cleanup scheduler.
 */
export const SOFT_DELETABLE_MODELS = [
  'user',
  'course',
  'lesson',
  'enrollment',
  'video',
  'quiz',
  'storageObject',
] as const;

export type SoftDeletableModel = (typeof SOFT_DELETABLE_MODELS)[number];
