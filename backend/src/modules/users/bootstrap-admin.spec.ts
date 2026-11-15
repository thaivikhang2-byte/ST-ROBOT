import { bootstrapAdministrator, bootstrapInitialAdministrator } from '../../../scripts/bootstrap-admin';
import { initializeAdministrator } from '../../../scripts/initialize-admin';
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

describe('Render first-start administrator', () => {
  const initial = { INITIAL_ADMIN_ENABLED: 'true', INITIAL_ADMIN_EMAIL: 'first-admin@school.local',
    INITIAL_ADMIN_PASSWORD: 'Fixture-initial-password-1234' };

  it('requires startup opt-in and never accepts the recovery environment', async () => {
    const f = fixture();
    await expect(bootstrapInitialAdministrator(f.db as any, { ...f.env })).rejects.toThrow('opt-in');
    expect(f.db.$transaction).not.toHaveBeenCalled();
    f.tx.user.count.mockResolvedValue(1);
    await expect(bootstrapInitialAdministrator(f.db as any, { ...initial,
      ALLOW_ADMIN_RECOVERY: 'true', BOOTSTRAP_RECOVERY_REASON: 'An otherwise valid protected recovery reason',
    })).resolves.toEqual({ created: false });
    expect(f.tx.user.create).not.toHaveBeenCalled();
  });

  it('skips disabled historical administrators and revoked assignments without changing role or account', async () => {
    const f = fixture();
    f.role.is_active = false; f.role.status = 'ARCHIVED';
    f.tx.user.count.mockResolvedValue(1);
    await expect(bootstrapInitialAdministrator(f.db as any, initial)).resolves.toEqual({ created: false });
    expect(f.tx.user.count).toHaveBeenCalledWith({ where: { OR: [
      { role_id: f.role.id }, { role_assignments: { some: { role_id: f.role.id } } },
    ] } });
    expect(f.tx.user.create).not.toHaveBeenCalled();
    expect(f.tx.role.update).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('creates an attested administrator once and never resets its password on repeat deploy', async () => {
    const f = fixture();
    await expect(bootstrapInitialAdministrator(f.db as any, initial)).resolves.toEqual({
      created: true, id: 'fixture-admin', verified: true,
    });
    const passwordHash = f.tx.user.create.mock.calls[0][0].data.password_hash;
    expect(await comparePassword(initial.INITIAL_ADMIN_PASSWORD, passwordHash)).toBe(true);
    f.tx.user.count.mockResolvedValue(1);
    await expect(bootstrapInitialAdministrator(f.db as any, { ...initial,
      INITIAL_ADMIN_PASSWORD: 'Fixture-different-password-9876' })).resolves.toEqual({ created: false });
    const dependencies = { bootstrap: jest.fn(), importCatalog: jest.fn(), retryOwner: jest.fn(), log: jest.fn() };
    await expect(initializeAdministrator(f.db as any, {}, dependencies)).resolves.toEqual({ created: false });
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
    expect(f.tx.user.create).toHaveBeenCalledTimes(1);
    expect(f.tx.user.create.mock.calls[0][0].data.password_hash).toBe(passwordHash);
  });

  it('serializes racing startups on the shared authorization-state lock before checking administrators', async () => {
    const f = fixture();
    let lock = Promise.resolve();
    let admins = 0;
    f.tx.user.count.mockImplementation(async () => admins);
    f.tx.user.create.mockImplementation(async () => { admins++; return { id: 'fixture-admin' }; });
    const db = { $transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => {
      let release = () => {};
      const tx = { ...f.tx, authorizationState: { update: jest.fn(async () => {
        const previous = lock;
        lock = new Promise<void>(resolve => { release = resolve; });
        await previous;
      }) } };
      try { return await callback(tx); } finally { release(); }
    }) };
    const results = await Promise.all([
      bootstrapInitialAdministrator(db as any, initial), bootstrapInitialAdministrator(db as any, initial),
    ]);
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(f.tx.user.create).toHaveBeenCalledTimes(1);
    expect(admins).toBe(1);
  });

  it('rejects malformed credentials before database writes', async () => {
    const f = fixture();
    await expect(bootstrapInitialAdministrator(f.db as any, { ...initial, INITIAL_ADMIN_PASSWORD: 'short' })).rejects.toThrow('validation');
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('scrubs all bootstrap secrets, imports only after creation, and reports a content-only retry', async () => {
    const f = fixture();
    const environment = { ...initial, BOOTSTRAP_ADMIN_PASSWORD: 'Legacy-fixture-secret' };
    const calls: string[] = [];
    const dependencies = {
      bootstrap: jest.fn(async (_db, env) => {
        calls.push('create');
        expect(environment).toEqual({});
        expect(env.INITIAL_ADMIN_PASSWORD).toBe(initial.INITIAL_ADMIN_PASSWORD);
        return { created: true as const, id: '5aaafcd8-0a6d-4582-a228-af0f44f446ed', verified: true };
      }),
      importCatalog: jest.fn(async () => { calls.push('catalog'); throw new Error(initial.INITIAL_ADMIN_PASSWORD); }),
      retryOwner: jest.fn(), log: jest.fn(),
    };
    await expect(initializeAdministrator(f.db as any, environment, dependencies)).rejects.toThrow(
      'INITIAL_ADMIN_CATALOG_RETRY_ID=5aaafcd8-0a6d-4582-a228-af0f44f446ed',
    );
    expect(calls).toEqual(['create', 'catalog']);
    expect(environment).toEqual({});
    expect(JSON.stringify(dependencies.log.mock.calls)).not.toContain(initial.INITIAL_ADMIN_PASSWORD);
    expect(dependencies.bootstrap.mock.calls[0][1]).toEqual({});
  });

  it('skips catalog after an existing administrator and hides unsafe bootstrap failures', async () => {
    const f = fixture();
    const dependencies = { bootstrap: jest.fn(async () => ({ created: false as const })),
      importCatalog: jest.fn(), retryOwner: jest.fn(), log: jest.fn() };
    await initializeAdministrator(f.db as any, { ...initial }, dependencies);
    expect(dependencies.importCatalog).not.toHaveBeenCalled();
    dependencies.bootstrap.mockRejectedValue(new Error(initial.INITIAL_ADMIN_PASSWORD));
    const environment = { ...initial };
    await expect(initializeAdministrator(f.db as any, environment, dependencies)).rejects.toThrow('No credentials logged');
    expect(environment).toEqual({});
    expect(JSON.stringify(dependencies.log.mock.calls)).not.toContain(initial.INITIAL_ADMIN_PASSWORD);
  });

  it('retries only content for an explicitly selected existing owner with no identity bootstrap', async () => {
    const f = fixture();
    const id = '5aaafcd8-0a6d-4582-a228-af0f44f446ed';
    const dependencies = { bootstrap: jest.fn(), importCatalog: jest.fn(async () => ({
      createdCourses: 0, createdLessons: 0, createdQuizzes: 0, sourceCourses: 5, sourceLessons: 30,
    })), retryOwner: jest.fn(), log: jest.fn() };
    const environment = { INITIAL_ADMIN_CATALOG_RETRY_ID: id };
    await expect(initializeAdministrator(f.db as any, environment, dependencies)).resolves.toEqual({ created: false });
    expect(dependencies.retryOwner).toHaveBeenCalledWith(f.db, id);
    expect(dependencies.importCatalog).toHaveBeenCalledWith(f.db, id);
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
    expect(f.tx.user.create).not.toHaveBeenCalled();
    expect(environment).toEqual({});
    await expect(initializeAdministrator(f.db as any, { ...initial,
      INITIAL_ADMIN_CATALOG_RETRY_ID: id }, dependencies)).rejects.toThrow('No credentials logged');
  });

  it('denies content retry for revoked administrator access without restoring an assignment', async () => {
    const id = '5aaafcd8-0a6d-4582-a228-af0f44f446ed';
    const db = {
      user: { findUniqueOrThrow: jest.fn(async () => ({
        id, is_active: true, is_email_verified: true, deleted_at: null,
        role: { id: 'role-id', name: 'superadmin', is_active: true, status: 'ACTIVE', group: 'MANAGER' },
        role_assignments: [{ role_id: 'role-id', revoked_at: new Date(), expires_at: null,
          scope_type: 'SYSTEM', scope_id: '' }],
      })) },
      auditLog: { findFirst: jest.fn(async () => ({ new_data: { verificationMethod: 'operator-attested' } })) },
      $transaction: jest.fn(),
    };
    const environment = { INITIAL_ADMIN_CATALOG_RETRY_ID: id };
    await expect(initializeAdministrator(db as any, environment)).rejects.toThrow('No credentials logged');
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(environment).toEqual({});
  });
});
