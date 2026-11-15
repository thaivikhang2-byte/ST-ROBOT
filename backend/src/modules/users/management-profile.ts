import type { RoleGroup } from '@prisma/client';
import { profile, type Identity } from '../auth/identity.repository';

/** Classification for the protected management list, never an authentication grant. */
export function studentManagementMetadata(user: Identity, now = new Date()) {
  const roles = user.rbac_migrated
    ? user.role_assignments.filter(assignment => !assignment.revoked_at &&
      (!assignment.expires_at || assignment.expires_at > now)).map(assignment => assignment.role)
    : [user.role];
  // Retain staff classification even when that role is temporarily disabled.
  // Unlocking a user must not turn a classroom action into staff-account recovery.
  const roleGroups: RoleGroup[] = [...new Set(roles.map(role => role.group))];
  const studentOnly = !user.deleted_at && user.role.group === 'STUDENT' && roles.length > 0 &&
    roles.every(role => role.group === 'STUDENT' && role.name !== 'guest' && role.is_active && role.status === 'ACTIVE');
  return { studentOnly, roleGroups };
}

export function managementProfile(user: Identity) {
  return { ...profile(user), management: studentManagementMetadata(user) };
}
