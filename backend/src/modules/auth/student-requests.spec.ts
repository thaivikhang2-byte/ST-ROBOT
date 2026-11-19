import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { assertActive } from './identity.repository';
import { JwtStrategy } from './strategies/jwt.strategy';
import * as hashes from '../../shared/utils/hash.util';

const password = 'Fixture-student-password-123';
const dto = { email: ' Student@Example.Test ', password, firstName: 'Student', lastName: 'Fixture' };
const tokens = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresIn: '15m' };
function fixture() {
  const role = { id: randomUUID(), name: 'student', group: 'STUDENT', status: 'ACTIVE',
    is_active: true, is_default: true, role_permissions: [{ permission: { name: 'learning:read' } }] };
  const user = { id: randomUUID(), email: 'student@example.test', password_hash: 'fixture-hash', auth_version: 2,
    first_name: 'Student', last_name: 'Fixture', avatar_url: null, created_at: new Date(), last_login_at: null,
    is_active: true, is_email_verified: true, student_approval_pending: false, deleted_at: null,
    rbac_migrated: true, role, role_assignments: [{ role, scope_type: 'SYSTEM', scope_id: '',
      revoked_at: null, expires_at: null }] };
  const session = { id: randomUUID(), user_id: user.id, family_id: randomUUID(), is_revoked: false,
    expires_at: new Date(Date.now() + 60000), ip_address: null, device_info: null };
  const tx = {
    role: { findUnique: jest.fn(async () => role) },
    user: { create: jest.fn(async (_input: any) => ({ id: user.id })),
      update: jest.fn(async (_input: any) => user) },
    refreshToken: { create: jest.fn(), findUnique: jest.fn(async () => session),
      updateMany: jest.fn(async () => ({ count: 1 })) },
    auditLog: { create: jest.fn(async (_input: any) => ({})) },
  };
  const db = { user: { findUnique: jest.fn(async (_input: any) => ({
    id: user.id, password_hash: user.password_hash, auth_version: user.auth_version,
  })) }, auditLog: tx.auditLog, $transaction: jest.fn(async callback => callback(tx)) };
  const tokenService = { generateTokenPair: jest.fn(async () => tokens),
    refreshExpiresAt: jest.fn(() => session.expires_at), verifyRefreshToken: jest.fn(async () => ({
      sub: user.id, sid: session.family_id, ver: user.auth_version,
    })) };
  const events = { emit: jest.fn() };
  const feature = { managedAccountsEnabled: true, approvalRegistrationEnabled: true, registrationEnabled: false };
  const config = new ConfigService({ feature });
  const service = new AuthService(db as any, tokenService as any, events as any, config);
  return { role, user, session, tx, db, tokenService, events, config, feature, service };
}

describe('Student requests and fresh authentication', () => {
  afterEach(() => jest.restoreAllMocks());

  it('creates only an inactive, unverified student with a password hash; emits no mail or tokens', async () => {
    const f = fixture();
    const response = await f.service.requestStudentAccount({ ...dto, roleId: randomUUID(), isActive: true } as any);
    expect(response).toMatchObject({ status: 'pending' });
    expect(response).not.toHaveProperty('user');
    expect(response).not.toHaveProperty('tokens');
    const query = f.tx.user.create.mock.calls[0][0];
    expect(query.data).toMatchObject({ email: 'student@example.test', role_id: f.role.id,
      is_active: false, is_email_verified: false, student_approval_pending: true,
      role_assignments: { create: { role_id: f.role.id } } });
    expect(await hashes.comparePassword(password, query.data.password_hash)).toBe(true);
    expect(query.data.password_hash).not.toBe(password);
    expect(f.tokenService.generateTokenPair).not.toHaveBeenCalled();
    expect(f.events.emit).not.toHaveBeenCalled();
    expect(JSON.stringify(f.tx.auditLog.create.mock.calls)).not.toContain(password);
  });

  it('returns the same response for duplicate addresses without resetting or reactivating them', async () => {
    const f = fixture();
    const expected = await f.service.requestStudentAccount(dto);
    f.tx.user.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002', clientVersion: 'fixture',
    }));
    expect(await f.service.requestStudentAccount(dto)).toEqual(expected);
    expect(f.tx.user.update).not.toHaveBeenCalled();
    expect(f.tokenService.generateTokenPair).not.toHaveBeenCalled();
  });

  it('rejects role and verification mass assignment at the public DTO boundary', async () => {
    const value = plainToInstance(RegisterDto, { ...dto, roleId: randomUUID(), isActive: true,
      isEmailVerified: true, student_approval_pending: false });
    const errors = await validate(value, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map(error => error.property).sort()).toEqual([
      'isActive', 'isEmailVerified', 'roleId', 'student_approval_pending',
    ]);
  });

  it('honors the mode and rejects retired, reassigned, inactive or nondefault student roles', async () => {
    for (const change of [{ status: 'ARCHIVED' }, { group: 'MANAGER' }, { is_active: false }, { is_default: false }]) {
      const f = fixture(); Object.assign(f.role, change);
      await expect(f.service.requestStudentAccount(dto)).rejects.toThrow();
      expect(f.tx.user.create).not.toHaveBeenCalled();
    }
    const f = fixture(); f.feature.approvalRegistrationEnabled = false;
    await expect(f.service.requestStudentAccount(dto)).rejects.toThrow();
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('publishes approval mode without enabling legacy SMTP registration or revealing configuration', async () => {
    const f = fixture();
    const controller = new AuthController(f.service, {} as any, f.config);
    expect(controller.options()).toMatchObject({ registrationEnabled: false,
      approvalRegistrationEnabled: true, registrationMode: 'approval', managedAccountsEnabled: true });
    await expect(f.service.register(dto)).rejects.toThrow('manager approval');
    expect(f.db.$transaction).not.toHaveBeenCalled();
    f.feature.managedAccountsEnabled = false;
    expect(controller.options()).toMatchObject({ approvalRegistrationEnabled: false, registrationMode: 'closed' });
  });

  it('denies pending login, refresh and shared fresh authorization even for inconsistent active rows', async () => {
    const f = fixture(); f.user.student_approval_pending = true;
    jest.spyOn(hashes, 'comparePassword').mockResolvedValue(true);
    await expect(f.service.login(dto)).rejects.toThrow('Invalid email or password');
    await expect(f.service.refreshToken({ refreshToken: tokens.refreshToken })).rejects.toThrow();
    expect(() => assertActive(f.user as any)).toThrow();
    expect(f.tokenService.generateTokenPair).not.toHaveBeenCalled();
    const claims = { sub: f.user.id, sid: f.session.family_id, ver: 2, jti: randomUUID(),
      type: 'access' as const, iat: 1, exp: 2 };
    const strategy = new JwtStrategy(new ConfigService({ jwt: { secret: 'fixture-jwt-secret' } }), {
      user: { findUnique: jest.fn(async () => ({ ...f.user, refresh_tokens: [{ id: f.session.id }] })) },
    } as any);
    await expect(strategy.validate(claims)).rejects.toThrow('Session is no longer active');
  });

  it('compares bcrypt before acquiring locks and refuses concurrent password or session-version changes', async () => {
    for (const change of [{ password_hash: 'replacement-hash' }, { auth_version: 3 }]) {
      const f = fixture();
      let compared = false;
      jest.spyOn(hashes, 'comparePassword').mockImplementation(async () => { compared = true; return true; });
      f.db.$transaction.mockImplementation(async callback => {
        expect(compared).toBe(true);
        Object.assign(f.user, change);
        return callback(f.tx);
      });
      await expect(f.service.login(dto)).rejects.toThrow('Invalid email or password');
      expect(f.tokenService.generateTokenPair).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    }
  });

  it('issues tokens for an unchanged login snapshot and refresh includes the locked fresh profile', async () => {
    const f = fixture(); jest.spyOn(hashes, 'comparePassword').mockResolvedValue(true);
    const login = await f.service.login(dto);
    expect(login.tokens).toEqual(tokens);
    expect(login.user.lastLoginAt).toBeInstanceOf(Date);
    expect(f.tx.user.update.mock.calls[0][0].data).toEqual({ auth_version: { increment: 0 } });
    f.user.first_name = 'Updated';
    const refreshed = await f.service.refreshToken({ refreshToken: tokens.refreshToken });
    expect(refreshed).toMatchObject({ tokens, user: { id: f.user.id, firstName: 'Updated' } });
    expect(refreshed.user).not.toHaveProperty('password_hash');
    expect(f.tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: f.session.id, is_revoked: false }, data: { is_revoked: true },
    });
    expect(f.db.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
