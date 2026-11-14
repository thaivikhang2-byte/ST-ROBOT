import type { PrismaClient } from '../src/database/client';
import { seed } from './seed';

function memoryDatabase() {
  const roles = new Map<string, Record<string, any>>();
  const permissions = new Map<string, Record<string, any>>();
  const grants = new Map<string, Record<string, any>>();
  const providers = new Map<string, Record<string, any>>();
  const quotas = new Map<string, Record<string, any>>();
  const settings = new Map<string, Record<string, any>>();
  const flags = new Map<string, Record<string, any>>();
  let sequence = 0;
  const upsert = (rows: Map<string, Record<string, any>>, unique: string) => jest.fn(async ({ where, update, create }) => {
    const key = where[unique];
    const row = rows.get(key);
    if (row) { Object.assign(row, update); return row; }
    const created = { id: `id-${++sequence}`, ...structuredClone(create) };
    rows.set(key, created);
    return created;
  });
  const tx = {
    role: {
      createMany: jest.fn(async ({ data }) => {
        if (roles.has(data.name)) return { count: 0 };
        roles.set(data.name, { id: `role-${++sequence}`, is_active: true, status: 'ACTIVE', revision: 1, ...structuredClone(data) });
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }) => roles.get(where.name)),
    },
    permission: { upsert: upsert(permissions, 'name') },
    rolePermission: { upsert: jest.fn(async ({ where, update, create }) => {
      const key = `${where.role_id_permission_id.role_id}:${where.role_id_permission_id.permission_id}`;
      const row = grants.get(key);
      if (row) { Object.assign(row, update); return row; }
      grants.set(key, structuredClone(create));
      return create;
    }) },
    aiProvider: { upsert: upsert(providers, 'id') },
    aiQuotaPolicy: { upsert: upsert(quotas, 'id') },
    setting: { upsert: upsert(settings, 'key') },
    featureFlag: { upsert: upsert(flags, 'key') },
  };
  const prisma = { $transaction: jest.fn(async work => work(tx)) } as unknown as PrismaClient;
  return { prisma, tx, roles, permissions, grants, providers, quotas, settings, flags };
}

describe('Initialize-only database defaults', () => {
  let log: jest.SpyInstance;
  beforeEach(() => { log = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => log.mockRestore());

  it('initializes usable roles and least-privilege grants on an empty database', async () => {
    const db = memoryDatabase();
    await seed(db.prisma);
    expect(db.roles.size).toBe(5);
    expect(db.roles.get('student')).toMatchObject({ is_active: true, is_default: true, group: 'STUDENT' });
    expect(db.roles.get('teacher')).toMatchObject({ group: 'TEACHER' });
    expect(db.roles.get('superadmin')).toMatchObject({ group: 'MANAGER' });
    const student = db.roles.get('student')!;
    const allowed = db.permissions.get('learning:update')!;
    const forbidden = db.permissions.get('roles:manage')!;
    expect(db.grants.has(`${student.id}:${allowed.id}`)).toBe(true);
    expect(db.grants.has(`${student.id}:${forbidden.id}`)).toBe(false);
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('never reactivates roles, resets administrator configuration, or restores revoked grants on repeat seed', async () => {
    const db = memoryDatabase();
    await seed(db.prisma);
    const student = db.roles.get('student')!;
    Object.assign(student, { is_active: false, is_default: false, group: 'TEACHER', status: 'DISABLED', revision: 7, description: 'Administrator-owned policy' });
    const expected = structuredClone(student);
    const revoked = `${student.id}:${db.permissions.get('learning:update')!.id}`;
    db.grants.delete(revoked);
    const grantCount = db.grants.size;
    Object.assign(db.providers.get('gemini')!, { type: 'openai-compatible', enabled: true });
    db.quotas.get('default')!.daily_tokens = 123;
    db.settings.get('site.name')!.value = 'Approved site title';
    db.flags.get('registration')!.is_enabled = false;
    db.tx.rolePermission.upsert.mockClear();
    await seed(db.prisma);
    expect(db.roles.get('student')).toEqual(expected);
    expect(db.grants.has(revoked)).toBe(false);
    expect(db.grants.size).toBe(grantCount);
    expect(db.tx.rolePermission.upsert).not.toHaveBeenCalled();
    expect(db.providers.get('gemini')).toMatchObject({ type: 'openai-compatible', enabled: true });
    expect(db.quotas.get('default')!.daily_tokens).toBe(123);
    expect(db.settings.get('site.name')!.value).toBe('Approved site title');
    expect(db.flags.get('registration')!.is_enabled).toBe(false);
  });

  it('initializes only a missing role without changing existing grants or disabled roles', async () => {
    const db = memoryDatabase();
    await seed(db.prisma);
    const teacherId = db.roles.get('teacher')!.id;
    db.roles.delete('teacher');
    for (const [key, row] of db.grants) if (row.role_id === teacherId) db.grants.delete(key);
    const student = db.roles.get('student')!;
    student.status = 'DISABLED'; student.is_active = false;
    const preserved = new Map(db.grants);
    db.tx.rolePermission.upsert.mockClear();
    await seed(db.prisma);
    const newTeacher = db.roles.get('teacher')!;
    expect(newTeacher.id).not.toBe(teacherId);
    expect(db.tx.rolePermission.upsert.mock.calls.every(([args]) => args.create.role_id === newTeacher.id)).toBe(true);
    for (const [key, value] of preserved) expect(db.grants.get(key)).toEqual(value);
    expect(db.roles.get('student')).toMatchObject({ status: 'DISABLED', is_active: false });
  });
});
