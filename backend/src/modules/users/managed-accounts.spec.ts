import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { UsersService } from './users.service';
import { ManagedStudentDto } from './dto/managed-student.dto';
import { comparePassword } from '../../shared/utils/hash.util';
import { AuthController } from '../auth/auth.controller';
import { envValidationSchema } from '../../config/env.validation';
import { MailService } from '../mail/mail.service';

const role = (name = 'student', group = 'STUDENT') => ({
  id: randomUUID(), name, group, is_active: true, status: 'ACTIVE',
  role_permissions: [{ permission: { name: 'learning:read' } }],
});
function identity(r = role(), extra: Record<string, unknown> = {}) {
  return { id: randomUUID(), email: 'fixture@example.test', first_name: 'Student', last_name: 'Fixture',
    is_active: true, is_email_verified: true, deleted_at: null, rbac_migrated: true, role_id: r.id,
    role: r, role_assignments: [{ role: r, scope_type: 'SYSTEM', scope_id: '', revoked_at: null, expires_at: null }], ...extra };
}
function fixture(enabled = true) {
  const student = role(), admin = role('superadmin', 'MANAGER');
  const current = { ...identity(admin), grants: [{ roleId: admin.id, roleName: 'superadmin', group: 'MANAGER',
    scopeType: 'SYSTEM', scopeId: '', permissions: ['users:create', 'users:update', 'roles:delegate', 'learning:read'] }],
    permissions: ['users:create', 'users:update', 'roles:delegate', 'learning:read'] };
  const actor = { id: current.id, roleName: 'superadmin', roleId: admin.id, grants: current.grants,
    permissions: current.permissions, isEmailVerified: true } as any;
  const tx = {
    role: { findUnique: jest.fn(async () => student) },
    user: {
      create: jest.fn(async ({ data }) => {
        const { role_assignments, ...fields } = data;
        return identity(student, fields);
      }),
      update: jest.fn(async (_query: any) => identity(student)),
    },
    credentialToken: { updateMany: jest.fn(async () => ({ count: 1 })) },
    refreshToken: { updateMany: jest.fn(async () => ({ count: 2 })) },
    auditLog: { create: jest.fn(async (_query: any) => ({})) },
  };
  const authorization = { serialize: jest.fn(), actor: jest.fn(async () => current), delegate: jest.fn() };
  const db = { $transaction: jest.fn(async callback => callback(tx)) };
  const service = new UsersService(db as any, authorization as any,
    new ConfigService({ feature: { managedAccountsEnabled: enabled } }));
  return { student, current, actor, tx, authorization, service };
}

describe('Explicit managed school accounts', () => {
  const dto = { email: ' Student@Example.Test ', firstName: 'Student', lastName: 'Fixture', password: 'Fixture-password-1234' };

  it('forces the student role, hashes password and records identity attestation without secrets', async () => {
    const f = fixture();
    const result = await f.service.createStudent({ ...dto, roleId: 'attacker-controlled' } as any, f.actor);
    const data = f.tx.user.create.mock.calls[0][0].data;
    expect(data.role_id).toBe(f.student.id);
    expect(data.is_email_verified).toBe(true);
    expect(data.email).toBe('student@example.test');
    expect(await comparePassword(dto.password, data.password_hash)).toBe(true);
    expect(result).not.toHaveProperty('password_hash');
    expect(f.authorization.actor).toHaveBeenCalledWith(f.tx, f.actor.id, 'users:create');
    expect(f.authorization.delegate).toHaveBeenCalledWith(f.tx, f.actor.id, ['learning:read'], 'STUDENT', 'SYSTEM', '');
    expect(JSON.stringify(f.tx.auditLog.create.mock.calls)).not.toContain(dto.password);
    expect(f.tx.auditLog.create.mock.calls.map(call => call[0].data.action)).toContain('user.identity_attested_by_manager');
  });

  it('rejects mass assignment through the public DTO rather than accepting role/verification fields', async () => {
    const input = plainToInstance(ManagedStudentDto, { ...dto, roleId: randomUUID(), isEmailVerified: true });
    const errors = await validate(input, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map(error => error.property).sort()).toEqual(['isEmailVerified', 'roleId']);
  });

  it('requires the explicit mode and fresh SYSTEM manager authority before creating anything', async () => {
    const disabled = fixture(false);
    await expect(disabled.service.createStudent(dto, disabled.actor)).rejects.toThrow();
    expect(disabled.tx.user.create).not.toHaveBeenCalled();
    const scoped = fixture();
    scoped.current.grants[0].scopeType = 'COURSE';
    await expect(scoped.service.createStudent(dto, scoped.actor)).rejects.toThrow();
    expect(scoped.tx.user.create).not.toHaveBeenCalled();
  });

  it('honors retired or reassigned student roles instead of restoring their authority', async () => {
    const f = fixture();
    f.student.status = 'ARCHIVED';
    await expect(f.service.createStudent(dto, f.actor)).rejects.toThrow();
    expect(f.tx.user.create).not.toHaveBeenCalled();
    expect(f.authorization.delegate).not.toHaveBeenCalled();
  });

  it('resets a student password, revokes all sessions and consumes pending credential tokens', async () => {
    const f = fixture(), target = identity(f.student);
    f.tx.user.update.mockImplementation(async () => target);
    await f.service.resetStudentPassword(target.id, { newPassword: dto.password }, f.actor);
    expect(f.tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { user_id: target.id, is_revoked: false }, data: { is_revoked: true },
    });
    expect(f.tx.credentialToken.updateMany).toHaveBeenCalledWith({
      where: { user_id: target.id, consumed_at: null }, data: { consumed_at: expect.any(Date) },
    });
    const update = f.tx.user.update.mock.calls.at(-1)![0];
    expect(await comparePassword(dto.password, update.data.password_hash)).toBe(true);
    expect(JSON.stringify(f.tx.auditLog.create.mock.calls)).not.toContain(dto.password);
  });

  it('cannot reset self or any student who also has a staff role', async () => {
    const f = fixture(), managerRole = role('manager', 'MANAGER');
    const target = identity(f.student);
    target.role_assignments.push({ role: managerRole, scope_type: 'SYSTEM', scope_id: '', revoked_at: null, expires_at: null });
    f.tx.user.update.mockImplementation(async () => target);
    await expect(f.service.resetStudentPassword(target.id, { newPassword: dto.password }, f.actor)).rejects.toThrow();
    expect(f.tx.refreshToken.updateMany).not.toHaveBeenCalled();
    f.tx.user.update.mockImplementation(async () => identity(f.student, { id: f.actor.id }));
    await expect(f.service.resetStudentPassword(f.actor.id, { newPassword: dto.password }, f.actor)).rejects.toThrow();
  });

  it('publishes only capability flags and never SMTP settings or secrets', () => {
    const controller = new AuthController({} as any, {} as any, new ConfigService({
      feature: { registrationEnabled: false, managedAccountsEnabled: true },
      mail: { provider: 'disabled', host: 'private-host', password: 'must-stay-private' },
      app: { nodeEnv: 'production' },
    }));
    expect(controller.options()).toEqual({ registrationEnabled: false, managedAccountsEnabled: true,
      emailDeliveryEnabled: false, approvalRegistrationEnabled: true, registrationMode: 'approval' });
    expect(JSON.stringify(controller.options())).not.toContain('private');
  });

  it('allows no SMTP only under explicit managed-only configuration; never accepts production file mail', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://fixture/test',
      JWT_SECRET: 'a'.repeat(48), JWT_REFRESH_SECRET: 'b'.repeat(48),
      CORS_ORIGIN: 'https://frontend.example', MAIL_PROVIDER: 'disabled',
      MANAGED_ACCOUNTS_ENABLED: true, FEATURE_REGISTRATION_ENABLED: false };
    expect(envValidationSchema.validate(base).error).toBeUndefined();
    for (const change of [ { MANAGED_ACCOUNTS_ENABLED: false }, { FEATURE_REGISTRATION_ENABLED: true },
      { CORS_ORIGIN: '*' }, { CORS_ORIGIN: 'http://frontend.example' },
      { CORS_ORIGIN: 'https://frontend.example/private' }, { MAIL_PROVIDER: 'file' } ])
      expect(envValidationSchema.validate({ ...base, ...change }).error).toBeDefined();
    const mail = new MailService(new ConfigService({ mail: { provider: 'disabled', host: 'accidental-host' } }));
    expect(() => mail.assertConfigured()).toThrow();
  });
});
