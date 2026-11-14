// ═══════════════════════════════════════════
// Prisma Seed — Initial Data
// ═══════════════════════════════════════════

import { PrismaClient } from '../src/database/client';

export async function seed(prisma: PrismaClient) {
  console.log('🌱 Initializing missing database defaults...');
  return prisma.$transaction(async (tx) => {

    // ── Roles ──────────────────────────────
    const roleDefinitions = [
      { name: 'superadmin', description: 'Super administrator with full access', is_default: false, group: 'MANAGER' },
      { name: 'admin', description: 'System administrator', is_default: false, group: 'MANAGER' },
      { name: 'teacher', description: 'Course instructor', is_default: false, group: 'TEACHER' },
      { name: 'student', description: 'Registered student', is_default: true, group: 'STUDENT' },
      { name: 'guest', description: 'Unauthenticated visitor', is_default: false, group: 'STUDENT' },
    ] as const;
    const roles = [];
    const initializedRoleIds = new Set<string>();
    for (const definition of roleDefinitions) {
      // INSERT ... ON CONFLICT DO NOTHING reports whether this transaction created the role.
      // Never infer initialization from missing grants: a manager may have revoked them.
      const inserted = await tx.role.createMany({ data: { ...definition }, skipDuplicates: true });
      const role = await tx.role.findUniqueOrThrow({ where: { name: definition.name } });
      roles.push(role);
      if (inserted.count === 1) initializedRoleIds.add(role.id);
    }
    console.log(`  ✅ ${initializedRoleIds.size} missing roles initialized; existing roles preserved`);

    // ── Permissions ────────────────────────
    const permissionData = [
      ...[
        ['learning', 'read'],
        ['learning', 'enroll'],
        ['learning', 'update'],
        ['quizzes', 'attempt'],
        ['quizzes', 'grade'],
        ['labs', 'manage'],
        ['practicals', 'submit'],
        ['practicals', 'review'],
      ].map(([resource, action]) => ({
        name: `${resource}:${action}`,
        resource,
        action,
        description: `${action} ${resource}`,
      })),
      {
        name: 'categories:manage',
        resource: 'categories',
        action: 'manage',
        description: 'Manage course categories',
      },
      { name: 'ai:chat', resource: 'ai', action: 'chat', description: 'Use AI generation' },
      {
        name: 'ai:embeddings',
        resource: 'ai',
        action: 'embeddings',
        description: 'Create embeddings',
      },
      { name: 'ai:usage', resource: 'ai', action: 'usage', description: 'View own AI usage' },
      { name: 'ai:premium', resource: 'ai', action: 'premium', description: 'Use premium models' },
      {
        name: 'ai:tools',
        resource: 'ai',
        action: 'tools',
        description: 'Request tool definitions; does not execute tools',
      },
      {
        name: 'ai:manage',
        resource: 'ai',
        action: 'manage',
        description: 'Manage AI registry and quotas',
      },
      // Users
      { name: 'users:create', resource: 'users', action: 'create', description: 'Create users' },
      { name: 'users:read', resource: 'users', action: 'read', description: 'View users' },
      { name: 'users:update', resource: 'users', action: 'update', description: 'Update users' },
      { name: 'users:delete', resource: 'users', action: 'delete', description: 'Delete users' },
      { name: 'users:manage', resource: 'users', action: 'manage', description: 'Manage all users' },

      // Courses
      {
        name: 'courses:create',
        resource: 'courses',
        action: 'create',
        description: 'Create courses',
      },
      { name: 'courses:read', resource: 'courses', action: 'read', description: 'View courses' },
      {
        name: 'courses:update',
        resource: 'courses',
        action: 'update',
        description: 'Update courses',
      },
      {
        name: 'courses:delete',
        resource: 'courses',
        action: 'delete',
        description: 'Delete courses',
      },
      {
        name: 'courses:publish',
        resource: 'courses',
        action: 'publish',
        description: 'Publish courses',
      },

      // Lessons
      {
        name: 'lessons:create',
        resource: 'lessons',
        action: 'create',
        description: 'Create lessons',
      },
      { name: 'lessons:read', resource: 'lessons', action: 'read', description: 'View lessons' },
      {
        name: 'lessons:update',
        resource: 'lessons',
        action: 'update',
        description: 'Update lessons',
      },
      {
        name: 'lessons:delete',
        resource: 'lessons',
        action: 'delete',
        description: 'Delete lessons',
      },

      // Quizzes
      {
        name: 'quizzes:create',
        resource: 'quizzes',
        action: 'create',
        description: 'Create quizzes',
      },
      { name: 'quizzes:read', resource: 'quizzes', action: 'read', description: 'View quizzes' },
      {
        name: 'quizzes:update',
        resource: 'quizzes',
        action: 'update',
        description: 'Update quizzes',
      },
      {
        name: 'quizzes:delete',
        resource: 'quizzes',
        action: 'delete',
        description: 'Delete quizzes',
      },

      // Uploads
      { name: 'uploads:create', resource: 'uploads', action: 'create', description: 'Upload files' },
      { name: 'uploads:read', resource: 'uploads', action: 'read', description: 'View uploads' },
      {
        name: 'uploads:delete',
        resource: 'uploads',
        action: 'delete',
        description: 'Delete uploads',
      },

      // Settings
      { name: 'settings:read', resource: 'settings', action: 'read', description: 'View settings' },
      {
        name: 'settings:update',
        resource: 'settings',
        action: 'update',
        description: 'Update settings',
      },

      // Audit & Analytics
      { name: 'audit:read', resource: 'audit', action: 'read', description: 'View audit logs' },
      {
        name: 'analytics:read',
        resource: 'analytics',
        action: 'read',
        description: 'View analytics',
      },
      {
        name: 'dashboard:read',
        resource: 'dashboard',
        action: 'read',
        description: 'View dashboard',
      },

      // Roles & Permissions
      { name: 'roles:manage', resource: 'roles', action: 'manage', description: 'Manage roles' },
      {
        name: 'permissions:manage',
        resource: 'permissions',
        action: 'manage',
        description: 'Manage permissions',
      },

      // Feature Flags
      {
        name: 'feature-flags:manage',
        resource: 'feature-flags',
        action: 'manage',
        description: 'Manage feature flags',
      },

      // API Keys
      {
        name: 'api-keys:create',
        resource: 'api-keys',
        action: 'create',
        description: 'Create API keys',
      },
      { name: 'api-keys:read', resource: 'api-keys', action: 'read', description: 'View API keys' },
      {
        name: 'api-keys:delete',
        resource: 'api-keys',
        action: 'delete',
        description: 'Delete API keys',
      },

      // Backup
      { name: 'backup:create', resource: 'backup', action: 'create', description: 'Create backups' },
      {
        name: 'backup:restore',
        resource: 'backup',
        action: 'restore',
        description: 'Restore backups',
      },
      { name: 'backup:read', resource: 'backup', action: 'read', description: 'View backups' },

      // System
      { name: 'system:read', resource: 'system', action: 'read', description: 'View system info' },
      { name: 'system:manage', resource: 'system', action: 'manage', description: 'Manage system' },
    ];

    permissionData.push(
      {
        name: 'roles:delegate',
        resource: 'roles',
        action: 'delegate',
        description: 'Delegate only explicitly authorized permissions and scopes',
      },
      {
        name: 'roles:assign',
        resource: 'roles',
        action: 'assign',
        description: 'Request scoped role assignments',
      },
      {
        name: 'approvals:manage',
        resource: 'approvals',
        action: 'manage',
        description: 'Decide requests within current delegation authority',
      },
      {
        name: 'enrollments:approve',
        resource: 'enrollments',
        action: 'approve',
        description: 'Approve enrollment in owned or assigned courses',
      },
    );
    const permissions = [];
    for (const p of permissionData) {
      const perm = await tx.permission.upsert({
        where: { name: p.name },
        update: {},
        create: p,
      });
      permissions.push(perm);
    }

    console.log(`  ✅ ${permissions.length} permissions seeded`);

    // ── Role ↔ Permission mapping ──────────
    const superadminRole = roles.find((r) => r.name === 'superadmin')!;
    const adminRole = roles.find((r) => r.name === 'admin')!;
    const teacherRole = roles.find((r) => r.name === 'teacher')!;
    const studentRole = roles.find((r) => r.name === 'student')!;

    // Superadmin gets ALL permissions
    for (const perm of initializedRoleIds.has(superadminRole.id) ? permissions : []) {
      await tx.rolePermission.upsert({
        where: { role_id_permission_id: { role_id: superadminRole.id, permission_id: perm.id } },
        update: {},
        create: { role_id: superadminRole.id, permission_id: perm.id },
      });
    }

    // Admin gets most permissions (except system:manage)
    const adminPerms = permissions.filter(
      (p) => !['system:manage', 'roles:delegate'].includes(p.name),
    );
    for (const perm of initializedRoleIds.has(adminRole.id) ? adminPerms : []) {
      await tx.rolePermission.upsert({
        where: { role_id_permission_id: { role_id: adminRole.id, permission_id: perm.id } },
        update: {},
        create: { role_id: adminRole.id, permission_id: perm.id },
      });
    }

    // Teacher gets content + upload permissions
    const teacherPermNames = [
      'enrollments:approve',
      'learning:read',
      'learning:enroll',
      'learning:update',
      'quizzes:attempt',
      'quizzes:grade',
      'labs:manage',
      'practicals:submit',
      'practicals:review',
      'ai:chat',
      'ai:usage',
      'courses:create',
      'courses:read',
      'courses:update',
      'courses:publish',
      'lessons:create',
      'lessons:read',
      'lessons:update',
      'lessons:delete',
      'quizzes:create',
      'quizzes:read',
      'quizzes:update',
      'quizzes:delete',
      'uploads:create',
      'uploads:read',
      'uploads:delete',
      'analytics:read',
      'dashboard:read',
    ];
    for (const permName of initializedRoleIds.has(teacherRole.id) ? teacherPermNames : []) {
      const perm = permissions.find((p) => p.name === permName);
      if (perm) {
        await tx.rolePermission.upsert({
          where: { role_id_permission_id: { role_id: teacherRole.id, permission_id: perm.id } },
          update: {},
          create: { role_id: teacherRole.id, permission_id: perm.id },
        });
      }
    }

    // Student gets read permissions
    const studentPermNames = [
      'learning:read',
      'learning:enroll',
      'learning:update',
      'quizzes:attempt',
      'practicals:submit',
      'courses:read',
      'lessons:read',
      'quizzes:read',
      'uploads:read',
      'ai:chat',
      'ai:usage',
    ];
    for (const permName of initializedRoleIds.has(studentRole.id) ? studentPermNames : []) {
      const perm = permissions.find((p) => p.name === permName);
      if (perm) {
        await tx.rolePermission.upsert({
          where: { role_id_permission_id: { role_id: studentRole.id, permission_id: perm.id } },
          update: {},
          create: { role_id: studentRole.id, permission_id: perm.id },
        });
      }
    }

    console.log('  ✅ Role-Permission mappings seeded');

    // Provider type constraints are owned by versioned migrations, never rewritten by a seed.
    for (const [id, type] of [
      ['openai', 'openai'],
      ['anthropic', 'anthropic'],
      ['gemini', 'gemini'],
      ['openrouter', 'openrouter'],
      ['workers-ai', 'workers-ai'],
    ] as const) {
      await tx.aiProvider.upsert({
        where: { id },
        update: {},
        create: { id, type, enabled: false },
      });
    }
    await tx.aiQuotaPolicy.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    });

    // ── Default Settings ───────────────────
    const settingsData = [
      {
        key: 'site.name',
        value: 'ST-Robot LMS',
        type: 'string',
        group: 'general',
        description: 'Site name',
      },
      {
        key: 'site.description',
        value: 'Learning Management System',
        type: 'string',
        group: 'general',
        description: 'Site description',
      },
      {
        key: 'upload.max_size',
        value: '52428800',
        type: 'number',
        group: 'upload',
        description: 'Max upload size in bytes',
      },
      {
        key: 'video.session_ttl',
        value: '7200',
        type: 'number',
        group: 'video',
        description: 'Video session TTL in seconds',
      },
      {
        key: 'video.heartbeat_interval',
        value: '30',
        type: 'number',
        group: 'video',
        description: 'Video heartbeat interval in seconds',
      },
    ];

    for (const s of settingsData) {
      await tx.setting.upsert({
        where: { key: s.key },
        update: {},
        create: s,
      });
    }

    console.log('  ✅ Default settings seeded');

    // ── Default Feature Flags ──────────────
    const flagsData = [
      { key: 'ai_chat', name: 'AI Chat', description: 'Enable AI chat feature', is_enabled: false },
      { key: 'cdn', name: 'CDN', description: 'Enable CDN for file delivery', is_enabled: false },
      {
        key: 'registration',
        name: 'Registration',
        description: 'Allow new user registration',
        is_enabled: true,
      },
      {
        key: 'notifications',
        name: 'Notifications',
        description: 'Enable notification system',
        is_enabled: true,
      },
    ];

    for (const f of flagsData) {
      await tx.featureFlag.upsert({
        where: { key: f.key },
        update: {},
        create: f,
      });
    }

    console.log('  ✅ Default feature flags seeded');

    console.log('\n🎉 Missing defaults initialized; existing administrator policy preserved.');
  }, { timeout: 60000 });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .catch(() => {
      console.error('Seed failed; check database/schema configuration');
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
