import { bootstrapAdministrator } from '../../../scripts/bootstrap-admin';
import { comparePassword } from '../../shared/utils/hash.util';

function fixture() {
  const role = { id: 'fixture-role', name: 'superadmin', is_active: true, status: 'ACTIVE', group: 'MANAGER' };
  const tx = { authorizationState: { update: jest.fn() },
    role: { findUniqueOrThrow: jest.fn(async () => role), update: jest.fn() },
    user: { count: jest.fn(async () => 0), create: jest.fn(async (_query: any) => ({ id: 'fixture-admin' })) },
    auditLog: { create: jest.fn() } };
  const db = { $transaction: jest.fn(async callback => callback(tx)) };
  const env = { ALLOW_INITIAL_ADMIN_BOOTSTRAP: 'true', BOOTSTRAP_ADMIN_EMAIL: 'fixture-admin@school.local',
    BOOTSTRAP_ADMIN_PASSWORD: 'Fixture-password-1234' };
  return { role, tx, db, env };
}

describe('Operator-only initial administrator', () => {
  it('requires explicit creation opt-in; merely importing the helper creates no account', async () => {
    const f = fixture();
    await expect(bootstrapAdministrator(f.db as any, {})).rejects.toThrow();
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('keeps email verification pending unless the operator explicitly attests identity', async () => {
    const f = fixture();
    await expect(bootstrapAdministrator(f.db as any, f.env)).resolves.toEqual({ id: 'fixture-admin', verified: false });
    expect(f.tx.user.create.mock.calls[0][0].data.is_email_verified).toBe(false);
  });

  it('supports an explicitly attested local admin, hashes the password and audits no credentials', async () => {
    const f = fixture();
    const result = await bootstrapAdministrator(f.db as any, { ...f.env, BOOTSTRAP_ADMIN_VERIFIED: 'true' });
    expect(result.verified).toBe(true);
    const data = f.tx.user.create.mock.calls[0][0].data;
    expect(data.is_email_verified).toBe(true);
    expect(await comparePassword(f.env.BOOTSTRAP_ADMIN_PASSWORD, data.password_hash)).toBe(true);
    expect(f.tx.auditLog.create.mock.calls[0][0].data.new_data).toEqual({ verificationMethod: 'operator-attested' });
    expect(JSON.stringify(f.tx.auditLog.create.mock.calls)).not.toContain(f.env.BOOTSTRAP_ADMIN_PASSWORD);
  });

  it('detects existing administrator assignments and still requires protected recovery', async () => {
    const f = fixture();f.tx.user.count.mockResolvedValue(1);
    await expect(bootstrapAdministrator(f.db as any, { ...f.env, BOOTSTRAP_ADMIN_VERIFIED: 'true' })).rejects.toThrow('Existing administrator');
    expect(f.tx.user.count).toHaveBeenCalledWith({ where: { OR: [
      { role_id: f.role.id }, { role_assignments: { some: { role_id: f.role.id } } },
    ] } });
    expect(f.tx.user.create).not.toHaveBeenCalled();
  });

  it('never reactivates an archived administrator role or promotes an existing account', async () => {
    const f = fixture();f.role.status = 'ARCHIVED';
    await expect(bootstrapAdministrator(f.db as any, f.env)).rejects.toThrow();
    expect(f.tx.role.update).not.toHaveBeenCalled();
    expect(f.tx.user.create).not.toHaveBeenCalled();
  });
});
