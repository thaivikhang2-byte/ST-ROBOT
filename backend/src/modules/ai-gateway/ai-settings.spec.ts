import { ForbiddenException } from '@nestjs/common';
import { AiRegistryService } from './ai-registry.service';
import { AiAdminController } from './ai-admin.controller';

function fixture(options: { verified?: boolean; scope?: string; permission?: string; active?: boolean; gateway?: boolean } = {}) {
  const role = { name: 'superadmin', group: 'MANAGER', status: 'ACTIVE', is_active: true,
    role_permissions: [{ permission: { name: options.permission ?? 'ai:manage' } }] };
  const actor = { id: 'operator', is_active: options.active ?? true, deleted_at: null,
    is_email_verified: options.verified ?? true, rbac_migrated: true,
    role_assignments: [{ role, scope_type: options.scope ?? 'SYSTEM', scope_id: '', revoked_at: null, expires_at: null }] };
  let enabled = false;
  const tx = { authorizationState: { update: jest.fn(async () => ({})) },
    user: { findUnique: jest.fn(async () => actor) },
    featureFlag: { findUnique: jest.fn(async () => ({ is_enabled: enabled })),
      upsert: jest.fn(async (args: { update: { is_enabled: boolean } }) => { enabled = args.update.is_enabled; return {}; }) },
    auditLog: { create: jest.fn(async () => ({})) } };
  const prisma = { $transaction: jest.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)) };
  const config = { get: jest.fn(() => options.gateway ?? true) };
  const registry = new AiRegistryService(prisma as never, {} as never, config as never, {} as never);
  return { registry, tx };
}

describe('Audited AI activation settings', () => {
  it('changes only the chat flag and reports the independent environment gate', async () => {
    const { registry, tx } = fixture({ gateway: false });
    expect(await registry.saveSettings(true, 'operator')).toEqual({ enabled: true, gatewayEnabled: false });
    expect(tx.authorizationState.update).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: { action: 'ai.chat_enabled', user_id: 'operator', resource: 'feature_flag', resource_id: 'ai_chat' } });
    expect(await registry.saveSettings(false, 'operator')).toEqual({ enabled: false, gatewayEnabled: false });
  });
  it.each([{ verified: false }, { scope: 'COURSE' }, { permission: 'ai:chat' }, { active: false }])(
    'rejects current unconfirmed/scoped/revoked authority before mutation: %j', async options => {
      const { registry, tx } = fixture(options);
      await expect(registry.saveSettings(true, 'operator')).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.featureFlag.upsert).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    },
  );
  it('checks current identity on reads too', async () => {
    const { registry } = fixture({ active: false });
    await expect(registry.settings('operator')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('checks credential administration transport before changing settings', () => {
    const registry = { saveSettings: jest.fn() };
    const vault = { assertTls: jest.fn(() => { throw new ForbiddenException(); }) };
    const controller = new AiAdminController(registry as never, {} as never, vault as never);
    expect(() => controller.changeSettings({ enabled: true }, { id: 'operator' } as never, {} as never)).toThrow(ForbiddenException);
    expect(registry.saveSettings).not.toHaveBeenCalled();
  });
});
