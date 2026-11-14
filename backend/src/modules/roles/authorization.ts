import type { AuthorizationScope, RoleGroup } from '@prisma/client';
import type { Identity } from '../auth/identity.repository';
import type { RequestUser } from '../../shared/sdk/auth/interfaces/request-user.interface';
export interface AuthorizationGrant {
  roleId: string;
  roleName: string;
  group: RoleGroup;
  scopeType: AuthorizationScope;
  scopeId: string;
  permissions: string[];
}
export function resolveGrants(user: Identity, now = new Date()): AuthorizationGrant[] {
  if (!user.is_active || user.deleted_at) return [];
  const roles = user.rbac_migrated
    ? user.role_assignments.filter((a) => !a.revoked_at && (!a.expires_at || a.expires_at > now))
    : [{ role: user.role, scope_type: 'SYSTEM' as const, scope_id: '' }];
  return roles
    .filter(
      (a) =>
        a.role.is_active &&
        a.role.status === 'ACTIVE' &&
        a.role.name !== 'guest' &&
        (a.scope_type !== 'SELF' || a.role.group === 'STUDENT'),
    )
    .map((a) => ({
      roleId: a.role.id,
      roleName: a.role.name,
      group: a.role.group,
      scopeType: a.scope_type,
      scopeId: a.scope_id,
      permissions: a.role.role_permissions.map((p) => p.permission.name),
    }));
}
export function grantPermissions(
  grants: AuthorizationGrant[],
  courseId?: string,
  selfId?: string,
): string[] {
  return [
    ...new Set(
      grants
        .filter(
          (g) =>
            g.scopeType === 'SYSTEM' ||
            (g.scopeType === 'COURSE' && g.scopeId === courseId) ||
            (g.scopeType === 'SELF' && g.scopeId === selfId),
        )
        .flatMap((g) => g.permissions),
    ),
  ];
}
export function assignedCourse(user: RequestUser, courseId: string): boolean {
  return (
    !!user.requiredPermissions?.length &&
    !!user.grants?.some(
      (g) =>
        g.scopeType === 'COURSE' &&
        g.scopeId === courseId &&
        ['TEACHER', 'MANAGER'].includes(g.group) &&
        user.requiredPermissions!.every((p) => g.permissions.includes(p)),
    )
  );
}
export function systemManager(user: RequestUser): boolean {
  return user.grants
    ? user.grants.some((g) => g.group === 'MANAGER' && g.scopeType === 'SYSTEM')
    : ['admin', 'superadmin'].includes(user.roleName);
}
