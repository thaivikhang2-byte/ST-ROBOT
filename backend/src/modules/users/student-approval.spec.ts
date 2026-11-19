import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { UsersService } from './users.service';
import { StudentOverviewQueryDto } from './dto/users-query.dto';
import { studentProgressSummary } from './student-progress-summary';
import { courseLessons } from '../learner-state/learner-state.policy';

const permissions = ['users:create', 'users:read', 'users:update', 'analytics:read', 'roles:delegate'];
function fixture() {
  const student = { id: randomUUID(), name: 'student', group: 'STUDENT', is_active: true,
    status: 'ACTIVE', role_permissions: [{ permission: { name: 'learning:read' } }] };
  const target = { id: randomUUID(), email: 'student@example.test', first_name: 'Student', last_name: 'Fixture',
    password_hash: 'preserved-fixture-hash', auth_version: 0, is_active: false, is_email_verified: false,
    student_approval_pending: true, deleted_at: null, rbac_migrated: true, role_id: student.id,
    role: student, role_assignments: [{ role: student, scope_type: 'SYSTEM', scope_id: '',
      revoked_at: null, expires_at: null }], created_at: new Date(), last_login_at: null };
  const adminRole = { ...student, id: randomUUID(), name: 'superadmin', group: 'MANAGER' };
  const current = { id: randomUUID(), role: adminRole, is_email_verified: true, permissions,
    grants: [{ roleId: adminRole.id, roleName: 'superadmin', group: 'MANAGER', scopeType: 'SYSTEM',
      scopeId: '', permissions }] };
  const actor = { id: current.id, roleName: 'superadmin' } as any;
  const tx = {
    role: { findUnique: jest.fn(async () => student) },
    user: { update: jest.fn(async (query: any) => {
      if (!query.data.auth_version) Object.assign(target, query.data);
      return target;
    }), findMany: jest.fn(async (_query: any) => [{ ...target, learner_state: {
      summary: { source: 'learner-self-report', courses: [{ courseId: Object.keys(courseLessons)[0], completedLessons: 2,
        notes: 'private-note', code: 'private-code' }], notes: 'private-top-level' }, updated_at: new Date(),
    } }]), count: jest.fn(async (_query: any) => 1) },
    refreshToken: { updateMany: jest.fn() }, credentialToken: { updateMany: jest.fn() },
    auditLog: { create: jest.fn(async (_query: any) => ({})) },
  };
  const authorization = { serialize: jest.fn(), actor: jest.fn(async (_tx, _id, permission) => {
    if (!current.permissions.includes(permission)) throw new Error('Fresh permission revoked');
    return current;
  }), delegate: jest.fn() };
  const db = { $transaction: jest.fn(async callback => callback(tx)) };
  const service = new UsersService(db as any, authorization as any,
    new ConfigService({ feature: { managedAccountsEnabled: true } }));
  return { service, target, student, current, actor, tx, authorization };
}

describe('Explicit manager approval and classroom overview', () => {
  it('approves only the pending identity, preserving its password and assignment with an audit attestation', async () => {
    const f = fixture();
    const result = await f.service.approveStudent(f.target.id, f.actor);
    expect(result).toMatchObject({ id: f.target.id, isActive: true, isEmailVerified: true,
      approvalPending: false, management: { studentOnly: true, roleGroups: ['STUDENT'] } });
    expect(f.target.password_hash).toBe('preserved-fixture-hash');
    expect(f.target.auth_version).toBe(0);
    expect(f.authorization.serialize).toHaveBeenCalled();
    expect(f.authorization.actor).toHaveBeenCalledWith(f.tx, f.actor.id, 'users:create');
    expect(f.authorization.delegate).toHaveBeenCalledWith(f.tx, f.actor.id, ['learning:read'], 'STUDENT', 'SYSTEM', '');
    expect(f.tx.user.update.mock.calls[1][0].data).toEqual({ is_active: true,
      is_email_verified: true, student_approval_pending: false });
    expect(f.tx.auditLog.create.mock.calls.map(call => call[0].data.action)).toEqual([
      'user.student_request_approved', 'user.identity_attested_by_manager',
    ]);
    await expect(f.service.approveStudent(f.target.id, f.actor)).rejects.toThrow('Only a pending');
    expect(f.tx.user.update.mock.calls.filter(call => call[0].data.is_active === true)).toHaveLength(1);
  });

  it('cannot approve active, locked, deleted, staff, mixed-role, retired-role or self accounts', async () => {
    const cases = [
      (f: ReturnType<typeof fixture>) => { f.target.is_active = true; },
      (f: ReturnType<typeof fixture>) => { f.target.student_approval_pending = false; },
      (f: ReturnType<typeof fixture>) => { f.target.deleted_at = new Date() as any; },
      (f: ReturnType<typeof fixture>) => { f.student.group = 'TEACHER'; },
      (f: ReturnType<typeof fixture>) => { f.target.role_assignments.push({ ...f.target.role_assignments[0],
        role: { ...f.student, group: 'MANAGER', name: 'hidden-staff', is_active: false } }); },
      (f: ReturnType<typeof fixture>) => { f.student.status = 'ARCHIVED'; },
      (f: ReturnType<typeof fixture>) => { f.actor.id = f.target.id; },
    ];
    for (const change of cases) {
      const f = fixture(); change(f);
      await expect(f.service.approveStudent(f.target.id, f.actor)).rejects.toThrow();
      expect(f.authorization.delegate).not.toHaveBeenCalled();
      expect(f.tx.user.update).toHaveBeenCalledTimes(1); // Lock only, no identity mutation.
      expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    }
  });

  it('requires fresh SYSTEM manager create authority and fresh role delegation', async () => {
    const scoped = fixture(); scoped.current.grants[0].scopeType = 'COURSE';
    await expect(scoped.service.approveStudent(scoped.target.id, scoped.actor)).rejects.toThrow();
    expect(scoped.tx.user.update).not.toHaveBeenCalled();
    const revoked = fixture(); revoked.current.permissions = ['users:read'];
    await expect(revoked.service.approveStudent(revoked.target.id, revoked.actor)).rejects.toThrow();
    expect(revoked.tx.user.update).not.toHaveBeenCalled();
    const delegation = fixture(); delegation.authorization.delegate.mockRejectedValue(new Error('Cannot delegate') as never);
    await expect(delegation.service.approveStudent(delegation.target.id, delegation.actor)).rejects.toThrow();
    expect(delegation.tx.user.update).toHaveBeenCalledTimes(1);
  });

  it('does not let generic activation, email, role changes or password resets bypass approval', async () => {
    for (const change of [{ isActive: true }, { email: 'changed@example.test' }, { roleId: randomUUID() }]) {
      const f = fixture();
      await expect(f.service.update(f.target.id, change, f.actor)).rejects.toThrow('student approval');
      expect(f.tx.user.update).toHaveBeenCalledTimes(1);
      expect(f.tx.refreshToken.updateMany).not.toHaveBeenCalled();
    }
    const f = fixture();
    await expect(f.service.updateStudentStatus(f.target.id, true, f.actor)).rejects.toThrow('student approval');
    f.target.is_active = true;
    await expect(f.service.resetStudentPassword(f.target.id, { newPassword: 'Fixture-new-password-123' }, f.actor)).rejects.toThrow();
    expect(f.tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('paginates and returns only derived counts plus authoritative student classification', async () => {
    const f = fixture(), query = Object.assign(new StudentOverviewQueryDto(), { page: 2, limit: 20, status: 'pending' });
    const value = await f.service.studentOverview(query, f.actor);
    expect(f.authorization.serialize).toHaveBeenCalled();
    expect(f.authorization.actor).toHaveBeenCalledWith(f.tx, f.actor.id, 'users:read');
    expect(f.authorization.actor).toHaveBeenCalledWith(f.tx, f.actor.id, 'analytics:read');
    expect(value.meta.pagination).toMatchObject({ page: 2, limit: 20, total: 1 });
    expect(value.data[0]).toMatchObject({ id: f.target.id, approvalPending: true,
      management: { studentOnly: true, roleGroups: ['STUDENT'] }, progressSummary: { completed: 2, total: 30 } });
    expect(JSON.stringify(value)).not.toMatch(/private-|password_hash|preserved-fixture|snapshot|auth_version/);
    const find = f.tx.user.findMany.mock.calls[0][0];
    expect(find).toMatchObject({ skip: 20, take: 20, where: { deleted_at: null,
      student_approval_pending: true, role: { group: 'STUDENT', name: { not: 'guest' } } } });
    expect(find.select.learner_state).toEqual({ select: { summary: true, updated_at: true } });
    expect(find.select.password_hash).toBeUndefined();
    expect(find.select.learner_state.select.snapshot).toBeUndefined();
    expect(find.where.role_assignments.none.role).toEqual({ group: { not: 'STUDENT' } });
  });

  it('denies the overview without current analytics permission and separates locked from pending status', async () => {
    const revoked = fixture(); revoked.current.permissions = ['users:read'];
    await expect(revoked.service.studentOverview(new StudentOverviewQueryDto(), revoked.actor)).rejects.toThrow();
    expect(revoked.tx.user.findMany).not.toHaveBeenCalled();
    const f = fixture();
    await f.service.studentOverview(Object.assign(new StudentOverviewQueryDto(), { status: 'locked' }), f.actor);
    expect(f.tx.user.findMany.mock.calls[0][0].where).toMatchObject({ is_active: false, student_approval_pending: false });
  });
});

describe('Safe learner self-report count projection', () => {
  it('uses canonical totals and excludes arbitrary content or invalid counts', () => {
    const ids = Object.keys(courseLessons);
    const summary = studentProgressSummary({ source: 'learner-self-report', courses: [
      { courseId: ids[0], completedLessons: 3, notes: 'private' },
      { courseId: ids[1], completedLessons: -1 }, { courseId: ids[2], completedLessons: 1.5 },
      { courseId: ids[3], completedLessons: 100000 }, { courseId: ids[4], completedLessons: '1' },
      { courseId: 'arbitrary', completedLessons: 999 }, null,
    ] });
    expect(summary).toMatchObject({ completed: 3, total: 30, percentage: 10 });
    expect(summary.courses).toHaveLength(5);
    expect(JSON.stringify(summary)).not.toMatch(/private|arbitrary/);
    expect(studentProgressSummary({ source: 'untrusted', courses: [{ courseId: ids[0], completedLessons: 3 }] }).completed).toBe(0);
    expect(studentProgressSummary(null).completed).toBe(0);
  });
});
