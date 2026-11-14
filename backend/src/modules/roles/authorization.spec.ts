import { resolveGrants, grantPermissions } from './authorization';
import type { Identity } from '../auth/identity.repository';
const role = (name: string, group = 'TEACHER', permissions = ['courses:update']) => ({
  id: name,
  name,
  group,
  status: 'ACTIVE',
  is_active: true,
  role_permissions: permissions.map((name) => ({ permission: { name } })),
});
const user = (assignments: unknown[]) =>
  ({
    id: 'u',
    is_active: true,
    deleted_at: null,
    rbac_migrated: true,
    role: role('student', 'STUDENT', ['courses:read']),
    role_assignments: assignments,
  }) as unknown as Identity;
describe('Database-backed authorization projection', () => {
  it('combines scopes without promoting course permissions to SYSTEM', () => {
    const grants = resolveGrants(
      user([
        {
          role: role('assistant'),
          scope_type: 'COURSE',
          scope_id: 'course-a',
          revoked_at: null,
          expires_at: null,
        },
        {
          role: role('student', 'STUDENT', ['learning:read']),
          scope_type: 'SYSTEM',
          scope_id: '',
          revoked_at: null,
          expires_at: null,
        },
      ]),
    );
    expect(grantPermissions(grants)).toEqual(['learning:read']);
    expect(grantPermissions(grants, 'course-a')).toContain('courses:update');
    expect(grantPermissions(grants, 'course-b')).not.toContain('courses:update');
  });
  it.each(['revoked', 'expired', 'disabled', 'draft', 'archived'])(
    'removes %s roles without cache or JWT permission claims',
    (state) => {
      const r = role('custom');
      if (state === 'disabled') r.is_active = false;
      if (state === 'draft') r.status = 'DRAFT';
      if (state === 'archived') r.status = 'ARCHIVED';
      const grants = resolveGrants(
        user([
          {
            role: r,
            scope_type: 'SYSTEM',
            scope_id: '',
            revoked_at: state === 'revoked' ? new Date() : null,
            expires_at: state === 'expired' ? new Date(0) : null,
          },
        ]),
      );
      expect(grants).toEqual([]);
    },
  );
  it('does not fall back to the legacy privileged role after migrated assignments are removed', () => {
    const identity = user([]);
    identity.role = role('admin', 'MANAGER', ['users:update']) as Identity['role'];
    expect(resolveGrants(identity)).toEqual([]);
  });
  it('SELF permissions require the same beneficiary', () => {
    const grants = resolveGrants(
      user([
        {
          role: role('student', 'STUDENT', ['learning:read']),
          scope_type: 'SELF',
          scope_id: 'u',
          revoked_at: null,
          expires_at: null,
        },
      ]),
    );
    expect(grantPermissions(grants, undefined, 'u')).toEqual(['learning:read']);
    expect(grantPermissions(grants, undefined, 'other')).toEqual([]);
  });
});
