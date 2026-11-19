import type { RoleGroup } from '@prisma/client';
import { profile, type Identity } from '../auth/identity.repository';

type ClassificationRole = Pick<Identity['role'], 'group' | 'name' | 'is_active' | 'status'>;
type ClassificationIdentity = {
  deleted_at: Date | null;
  rbac_migrated: boolean;
  role: ClassificationRole;
  role_assignments: Array<{ role: ClassificationRole; revoked_at: Date | null; expires_at: Date | null }>;
};

/** Classification for the protected management list, never an authentication grant. */
export function studentManagementMetadata(user: ClassificationIdentity, now = new Date()) {
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
  return { ...profile(user), approvalPending: user.student_approval_pending === true,
    management: studentManagementMetadata(user) };
}
