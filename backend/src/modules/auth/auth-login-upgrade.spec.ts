import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AuthService } from './auth.service';
import * as hashes from '../../shared/utils/hash.util';

const password = 'Fixture-password-123';
const legacyHash = '$2b$12$' + 'A'.repeat(53);
const encoded = (bytes: number, value: number) => Buffer.alloc(bytes, value).toString('base64').replace(/=+$/, '');
const argonHash = (value: number) => `$argon2id$v=19$m=65536,t=3,p=1$${encoded(16, value)}$${encoded(32, value)}`;
const firstArgon = argonHash(1), concurrentArgon = argonHash(2), replacementArgon = argonHash(3);

function fixture(storedHash = legacyHash) {
  let transactionDepth = 0;
  let locks = 0;
  let beforeLock: (() => void) | undefined;
  const role = { id: randomUUID(), name: 'student', group: 'STUDENT', status: 'ACTIVE', is_active: true,
    role_permissions: [{ permission: { name: 'learning:read' } }] };
  const user: any = {
    id: randomUUID(), email: 'fixture@example.test', password_hash: storedHash, auth_version: 7,
    first_name: 'Fixture', last_name: 'Learner', avatar_url: null, created_at: new Date(), last_login_at: null,
    is_active: true, is_email_verified: true, student_approval_pending: false, deleted_at: null,
    rbac_migrated: true, role,
    role_assignments: [{ role, scope_type: 'SYSTEM', scope_id: '', revoked_at: null, expires_at: null }],
  };
  const snapshot = () => ({ id: user.id, password_hash: user.password_hash, auth_version: user.auth_version });
  const tx = {
    user: { update: jest.fn(async ({ data }: any) => {
      if (data.auth_version?.increment === 0) { locks++; beforeLock?.(); }
      if (data.password_hash) user.password_hash = data.password_hash;
      if (data.last_login_at) user.last_login_at = data.last_login_at;
      return { ...user };
    }) },
    refreshToken: { create: jest.fn(async () => ({})), updateMany: jest.fn() },
    auditLog: { create: jest.fn(async (_input: any) => ({})) },
  };
  const db = { user: { findUnique: jest.fn(async (_args: any) => snapshot()) }, auditLog: tx.auditLog,
    $transaction: jest.fn(async callback => {
      transactionDepth++;
      try { return await callback(tx); } finally { transactionDepth--; }
    }) };
  const tokens = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresIn: '15m' };
  const tokenService = { generateTokenPair: jest.fn(async () => tokens), refreshExpiresAt: jest.fn(() => new Date(Date.now() + 60000)) };
  const events = { emit: jest.fn() };
  const service = new AuthService(db as any, tokenService as any, events as any, new ConfigService());
  const outside = () => expect(transactionDepth).toBe(0);
  const compare = jest.spyOn(hashes, 'comparePassword').mockImplementation(async () => { outside(); return true; });
  const hash = jest.spyOn(hashes, 'hashPassword').mockImplementation(async () => { outside(); return firstArgon; });
  const failedBudget = jest.spyOn(hashes, 'consumeFailedPasswordBudget').mockImplementation(async () => { outside(); });
  const missingBudget = jest.spyOn(hashes, 'consumeMissingPasswordBudget').mockImplementation(async () => { outside(); });
  return { user, role, tx, db, tokenService, tokens, events, service, compare, hash, failedBudget, missingBudget,
    setBeforeLock: (run: () => void) => { beforeLock = run; }, lockCount: () => locks, snapshot };
}

describe('Safe mixed-password login and opportunistic upgrade', () => {
  afterEach(() => jest.restoreAllMocks());

  it('migrates a verified legacy candidate in the existing last-login write without changing auth version or sessions', async () => {
    const f = fixture();
    const result = await f.service.login({ email: f.user.email, password });
    expect(f.compare).toHaveBeenCalledWith(password, legacyHash);
    expect(f.hash).toHaveBeenCalledWith(password);
    expect(f.user.password_hash).toBe(firstArgon);
    expect(f.user.auth_version).toBe(7);
    expect(f.tx.user.update).toHaveBeenCalledTimes(2); // Existing lock, then existing last-login write.
    expect(f.tx.user.update.mock.calls[1][0].data).toEqual({ password_hash: firstArgon, last_login_at: expect.any(Date) });
    expect(f.tokenService.generateTokenPair).toHaveBeenCalledWith(expect.objectContaining({ sub: f.user.id, ver: 7 }));
    expect(f.tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(result.tokens).toEqual(f.tokens);
    expect(result.user.permissions).toEqual(['learning:read']);
    expect(result.user).not.toHaveProperty('password_hash');
  });

  it('does not rehash an existing Argon account or repeat any cached verification', async () => {
    const f = fixture(firstArgon);
    await f.service.login({ email: f.user.email, password });
    await f.service.login({ email: f.user.email, password });
    expect(f.compare).toHaveBeenCalledTimes(2);
    expect(f.hash).not.toHaveBeenCalled();
    expect(f.failedBudget).not.toHaveBeenCalled();
    expect(f.db.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['x'.repeat(72), true], ['đ'.repeat(36), true], ['x'.repeat(73), false], ['đ'.repeat(37), false],
  ])('keeps the 72-byte bcrypt migration boundary for candidate %s', async (candidate, upgrade) => {
    const f = fixture();
    await f.service.login({ email: f.user.email, password: candidate as string });
    expect(f.hash).toHaveBeenCalledTimes(upgrade ? 1 : 0);
    expect(f.user.password_hash).toBe(upgrade ? firstArgon : legacyHash);
  });

  it('allows one concurrent algorithm upgrade by re-reading and verifying the new hash outside the next lock', async () => {
    const f = fixture();
    f.setBeforeLock(() => { if (f.lockCount() === 1) f.user.password_hash = concurrentArgon; });
    await f.service.login({ email: f.user.email, password });
    expect(f.db.$transaction).toHaveBeenCalledTimes(2);
    expect(f.db.user.findUnique).toHaveBeenCalledTimes(2);
    expect(f.db.user.findUnique.mock.calls[1][0].where).toEqual({ id: f.user.id });
    expect(f.compare.mock.calls.map(call => call[1])).toEqual([legacyHash, concurrentArgon]);
    expect(f.user.password_hash).toBe(concurrentArgon); // Never replace the winner with the losing precomputed hash.
    expect(f.tokenService.generateTokenPair).toHaveBeenCalledTimes(1);
    expect(f.tx.auditLog.create.mock.calls.map(call => (call[0] as any).data.action)).toEqual(['auth.login']);
  });

  it('bounds migration retry to one when the second locked hash changes again', async () => {
    const f = fixture();
    f.setBeforeLock(() => { f.user.password_hash = f.lockCount() === 1 ? concurrentArgon : replacementArgon; });
    await expect(f.service.login({ email: f.user.email, password })).rejects.toThrow('Invalid email or password');
    expect(f.compare).toHaveBeenCalledTimes(2);
    expect(f.db.$transaction).toHaveBeenCalledTimes(2);
    expect(f.tokenService.generateTokenPair).not.toHaveBeenCalled();
  });

  it.each(['before-first-lock', 'before-retry-read', 'after-retry-verification'])('rejects a password reset %s', async phase => {
    const f = fixture();
    f.setBeforeLock(() => {
      if (f.lockCount() === 1) {
        f.user.password_hash = concurrentArgon;
        if (phase === 'before-first-lock') f.user.auth_version++;
      }
    });
    if (phase === 'before-retry-read') f.db.user.findUnique.mockImplementation(async args => {
      if (args.where.id) f.user.auth_version++;
      return f.snapshot();
    });
    if (phase === 'after-retry-verification') f.compare.mockImplementation(async (_password, hash) => {
      if (hash === concurrentArgon) f.user.auth_version++;
      return true;
    });
    await expect(f.service.login({ email: f.user.email, password })).rejects.toThrow('Invalid email or password');
    expect(f.tokenService.generateTokenPair).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create.mock.calls.map(call => (call[0] as any).data.action)).toEqual(['auth.login_failed']);
  });

  it.each(['unknown-hash', firstArgon])('does not retry arbitrary same-version replacement of %s', async original => {
    const f = fixture(original === 'unknown-hash' ? legacyHash : firstArgon);
    f.setBeforeLock(() => { f.user.password_hash = original === 'unknown-hash' ? 'malformed-replacement' : concurrentArgon; });
    await expect(f.service.login({ email: f.user.email, password })).rejects.toThrow('Invalid email or password');
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tokenService.generateTokenPair).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'pending', 'deleted', 'revoked-grant', 'expired-grant', 'inactive-role'])('checks fresh %s before granting a session or committing an upgrade', async change => {
    const f = fixture();
    f.setBeforeLock(() => {
      if (change === 'inactive') f.user.is_active = false;
      if (change === 'pending') f.user.student_approval_pending = true;
      if (change === 'deleted') f.user.deleted_at = new Date();
      if (change === 'revoked-grant') f.user.role_assignments[0].revoked_at = new Date();
      if (change === 'expired-grant') f.user.role_assignments[0].expires_at = new Date(Date.now() - 60000);
      if (change === 'inactive-role') f.role.is_active = false;
    });
    await expect(f.service.login({ email: f.user.email, password })).rejects.toThrow('Invalid email or password');
    expect(f.user.password_hash).toBe(legacyHash);
    expect(f.tokenService.generateTokenPair).not.toHaveBeenCalled();
    expect(f.failedBudget).not.toHaveBeenCalled(); // Successful verification is not a failed-password probe.
  });

  it('uses the complementary denial budget on wrong passwords and the full budget for missing identities', async () => {
    const f = fixture();
    f.compare.mockResolvedValue(false);
    await expect(f.service.login({ email: f.user.email, password })).rejects.toThrow('Invalid email or password');
    expect(f.failedBudget).toHaveBeenCalledWith(password, legacyHash);
    expect(f.hash).not.toHaveBeenCalled();
    f.db.user.findUnique.mockResolvedValue(null as any);
    await expect(f.service.login({ email: 'missing@example.test', password })).rejects.toThrow('Invalid email or password');
    expect(f.missingBudget).toHaveBeenCalledWith(password);
    expect(f.compare).toHaveBeenCalledTimes(1);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tokenService.generateTokenPair).not.toHaveBeenCalled();
  });
});
