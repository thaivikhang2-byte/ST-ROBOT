// ═══════════════════════════════════════════
// Shared Constants — Permissions
// Format: resource:action
// ═══════════════════════════════════════════

export const Permission = {
  // Users
  USERS_CREATE: 'users:create',
  USERS_READ: 'users:read',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  USERS_MANAGE: 'users:manage',

  // Courses
  COURSES_CREATE: 'courses:create',
  COURSES_READ: 'courses:read',
  COURSES_UPDATE: 'courses:update',
  COURSES_DELETE: 'courses:delete',
  COURSES_PUBLISH: 'courses:publish',

  // Lessons
  LESSONS_CREATE: 'lessons:create',
  LESSONS_READ: 'lessons:read',
  LESSONS_UPDATE: 'lessons:update',
  LESSONS_DELETE: 'lessons:delete',

  // Quizzes
  QUIZZES_CREATE: 'quizzes:create',
  QUIZZES_READ: 'quizzes:read',
  QUIZZES_UPDATE: 'quizzes:update',
  QUIZZES_DELETE: 'quizzes:delete',
  QUIZZES_ATTEMPT: 'quizzes:attempt',
  QUIZZES_GRADE: 'quizzes:grade',

  LEARNING_READ: 'learning:read',
  LEARNING_ENROLL: 'learning:enroll',
  LEARNING_UPDATE: 'learning:update',
  LABS_MANAGE: 'labs:manage',
  PRACTICALS_SUBMIT: 'practicals:submit',
  PRACTICALS_REVIEW: 'practicals:review',

  // Uploads
  UPLOADS_CREATE: 'uploads:create',
  UPLOADS_READ: 'uploads:read',
  UPLOADS_DELETE: 'uploads:delete',

  // Settings
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',

  // Audit
  AUDIT_READ: 'audit:read',

  // Analytics
  ANALYTICS_READ: 'analytics:read',

  // Dashboard
  DASHBOARD_READ: 'dashboard:read',

  // Roles & Permissions
  ROLES_MANAGE: 'roles:manage',
  PERMISSIONS_MANAGE: 'permissions:manage',

  // Feature Flags
  FEATURE_FLAGS_MANAGE: 'feature-flags:manage',

  // API Keys
  API_KEYS_CREATE: 'api-keys:create',
  API_KEYS_READ: 'api-keys:read',
  API_KEYS_DELETE: 'api-keys:delete',

  // Backup
  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_READ: 'backup:read',

  // System
  SYSTEM_READ: 'system:read',
  SYSTEM_MANAGE: 'system:manage',
} as const;

export type PermissionType = (typeof Permission)[keyof typeof Permission];
