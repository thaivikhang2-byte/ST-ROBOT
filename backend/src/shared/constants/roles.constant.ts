// ═══════════════════════════════════════════
// Shared Constants — Roles
// ═══════════════════════════════════════════

export const Role = {
  GUEST: 'guest',
  STUDENT: 'student',
  TEACHER: 'teacher',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
} as const;

export type RoleType = (typeof Role)[keyof typeof Role];

export const DEFAULT_ROLES: { name: string; description: string; isDefault: boolean }[] = [
  { name: Role.GUEST, description: 'Unauthenticated visitor', isDefault: false },
  { name: Role.STUDENT, description: 'Registered student', isDefault: true },
  { name: Role.TEACHER, description: 'Course instructor', isDefault: false },
  { name: Role.ADMIN, description: 'System administrator', isDefault: false },
  { name: Role.SUPERADMIN, description: 'Super administrator with full access', isDefault: false },
];
