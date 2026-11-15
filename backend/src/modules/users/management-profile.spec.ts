import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { managementProfile, studentManagementMetadata } from './management-profile';
import { UsersService } from './users.service';

const role = (group = 'STUDENT', name = 'student', active = true) => ({
  id: randomUUID(), group, name, is_active: active, status: 'ACTIVE',
  role_permissions: [{ permission: { name: 'learning:read' } }],
});
const assignment = (value: ReturnType<typeof role>, extra = {}) => ({
  role: value, scope_type: 'SYSTEM', scope_id: '', revoked_at: null, expires_at: null, ...extra,
});
function identity(extra: Record<string, unknown> = {}) {
  const student = role();
  return { id: randomUUID(), email: 'management-fixture@example.test', first_name: 'Student', last_name: 'Fixture',
    is_active: false, is_email_verified: true, deleted_at: null, rbac_migrated: true,
    role: student, role_assignments: [assignment(student)], ...extra } as any;
}

describe('Protected management classification for inactive accounts', () => {
  it('allows a disabled student to be identified without restoring effective roles or permissions', () => {
    const user = identity(), value = managementProfile(user);
    expect(value.management).toEqual({ studentOnly: true, roleGroups: ['STUDENT'] });
    expect(value.isActive).toBe(false);
    expect(value.roles).toEqual([]);
    expect(value.permissions).toEqual([]);
    expect(value).not.toHaveProperty('password_hash');
  });

  it('rejects mixed or temporarily disabled staff assignments even if the legacy role says student', () => {
    for (const active of [true, false]) {
      const user = identity();
      user.role_assignments.push(assignment(role('TEACHER', 'course-assistant', active)));
      expect(studentManagementMetadata(user).studentOnly).toBe(false);
      expect(managementProfile(user).roles).toEqual([]);
    }
    const legacyStaff = identity({ role: role('MANAGER', 'custom-manager') });
    expect(studentManagementMetadata(legacyStaff).studentOnly).toBe(false);
  });

  it('ignores expired or revoked appointments, but requires at least one available student role', () => {
    const user = identity();
    user.role_assignments.push(assignment(role('TEACHER', 'old-teacher'), { revoked_at: new Date() }));
    user.role_assignments.push(assignment(role('MANAGER', 'expired-manager'), { expires_at: new Date('2020-01-01') }));
    expect(studentManagementMetadata(user).studentOnly).toBe(true);
    expect(studentManagementMetadata(identity({ role_assignments: [] })).studentOnly).toBe(false);
    expect(studentManagementMetadata(identity({ deleted_at: new Date() })).studentOnly).toBe(false);
    expect(studentManagementMetadata(identity({ role: role('STUDENT', 'guest'), rbac_migrated: false })).studentOnly).toBe(false);
  });

  function serviceFixture(target = identity()) {
    const current = { grants: [{ group: 'MANAGER', scopeType: 'SYSTEM', permissions: ['users:update'] }] };
    const tx = {
      user: { update: jest.fn(async (query: any) => {
        if (typeof query.data.is_active === 'boolean') target.is_active = query.data.is_active;
        return target;
      }) },
      refreshToken: { updateMany: jest.fn(async () => ({ count: 1 })) },
      credentialToken: { updateMany: jest.fn(async () => ({ count: 0 })) },
      auditLog: { create: jest.fn(async () => ({})) },
      notification: { create: jest.fn(async () => ({})) },
    };
    const authorization = { serialize: jest.fn(), actor: jest.fn(async () => current) };
    const database = { $transaction: jest.fn(async callback => callback(tx)) };
    const service = new UsersService(database as any, authorization as any, new ConfigService());
    const actor = { id: randomUUID(), roleName: 'superadmin' } as any;
    return { service, target, tx, current, actor };
  }

  it('unlocks a disabled student under fresh SYSTEM manager authority and retains token revocation', async () => {
    const f = serviceFixture();
    const result = await f.service.updateStudentStatus(f.target.id, true, f.actor);
    expect(result.isActive).toBe(true);
    expect(f.tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { user_id: f.target.id, is_revoked: false }, data: { is_revoked: true },
    });
    expect(f.tx.auditLog.create).toHaveBeenCalled();
  });

  it('rejects classroom status changes for hidden staff, self and course-scoped managers', async () => {
    const mixed = identity(); mixed.role_assignments.push(assignment(role('TEACHER', 'hidden-teacher')));
    const staff = serviceFixture(mixed);
    await expect(staff.service.updateStudentStatus(mixed.id, true, staff.actor)).rejects.toThrow();
    expect(staff.tx.refreshToken.updateMany).not.toHaveBeenCalled();
    const self = serviceFixture(); self.actor.id = self.target.id;
    await expect(self.service.updateStudentStatus(self.target.id, true, self.actor)).rejects.toThrow();
    const scoped = serviceFixture(); scoped.current.grants[0].scopeType = 'COURSE';
    await expect(scoped.service.updateStudentStatus(scoped.target.id, true, scoped.actor)).rejects.toThrow();
  });
});
