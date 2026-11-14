// ═══════════════════════════════════════════
// Policy SDK — Policy Interface
// Business rule enforcement beyond RBAC
// ═══════════════════════════════════════════

import { RequestUser } from '../auth/interfaces/request-user.interface';

/**
 * Policy interface for context-aware authorization.
 * Enforces business rules that RBAC alone cannot express.
 *
 * @example
 * class CourseOwnerPolicy implements IPolicy {
 *   async validate(user, context) {
 *     return context.course.creatorId === user.id;
 *   }
 * }
 */
export interface IPolicy<TContext = any> {
  validate(user: RequestUser, context: TContext): Promise<boolean>;
}
