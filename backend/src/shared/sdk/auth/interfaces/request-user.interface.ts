// ═══════════════════════════════════════════
// Auth SDK — Request User Interface
// ═══════════════════════════════════════════

import type { AuthorizationGrant } from '../../../../modules/roles/authorization';
export interface RequestUser {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  isActive: boolean;
  isEmailVerified: boolean;
  sessionId: string;
  grants?: AuthorizationGrant[];
  scopeCourseId?: string;
  requiredPermissions?: string[];
}
