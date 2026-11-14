// ═══════════════════════════════════════════
// Policy SDK — Base Policy
// ═══════════════════════════════════════════

import { RequestUser } from '../auth/interfaces/request-user.interface';
import { IPolicy } from './policy.interface';

export abstract class BasePolicy<TContext = any> implements IPolicy<TContext> {
  abstract validate(user: RequestUser, context: TContext): Promise<boolean>;

  /**
   * Check if user is the owner of a resource.
   */
  protected isOwner(user: RequestUser, ownerId: string): boolean {
    return user.id === ownerId;
  }

  /**
   * Check if user has a specific role.
   */
  protected hasRole(user: RequestUser, role: string): boolean {
    return user.grants ? user.grants.some((g) => g.roleName === role) : user.roleName === role;
  }

  /**
   * Administrative role check only; each policy must still enforce resource invariants.
   */
  protected isAdmin(user: RequestUser): boolean {
    return user.grants
      ? user.grants.some((g) => g.group === 'MANAGER' && g.scopeType === 'SYSTEM')
      : ['admin', 'superadmin'].includes(user.roleName);
  }
}
