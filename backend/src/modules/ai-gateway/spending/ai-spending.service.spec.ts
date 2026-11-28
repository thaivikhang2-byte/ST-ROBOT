import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AiModel, AiSpendPolicy, Prisma } from '@prisma/client';
import type { RequestUser } from '../../../shared/sdk';
import { AiQuotaService } from '../ai-quota.service';
import { AiSpendingController } from './ai-spending.controller';
import { AiSpendingDto } from './ai-spending.dto';
import { AiSpendingService, confirmedModelPricing, effectiveDailyBudget, reserveCost } from './ai-spending.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const actor = { id: '00000000-0000-4000-8000-000000000001', sessionId: 'session-family', scopeCourseId: 'untrusted-course' } as RequestUser;
const now = new Date('2026-11-27T10:00:00Z');
const model = (changes: Partial<AiModel> = {}) => ({
  id: '00000000-0000-4000-8000-000000000002', provider_id: 'woku', model_id: 'operator-chosen-model',
  input_price: D('1'), output_price: D('2'), pricing_version: 'operator-confirmed:fixture', enabled: true,
  ...changes,
} as AiModel);
const policy = (changes: Partial<AiSpendPolicy> = {}) => ({
  id: 'default', enabled: true, economy_enabled: true, total_budget_usd: D('1'), daily_budget_usd: D('0.03'), reserve_usd: D('0.4'),
  starts_at: new Date('2026-11-26T00:00:00+07:00'), reserve_from: new Date('2026-12-12T00:00:00+07:00'),
  ends_at: new Date('2026-12-13T00:00:00+07:00'), revision: 1, updated_by_id: actor.id, updated_at: now,
  ...changes,
} as AiSpendPolicy);
const totals = (changes: Partial<{spent: Prisma.Decimal; reserved: Prisma.Decimal; daily_spent: Prisma.Decimal; daily_reserved: Prisma.Decimal; unknown: bigint}> = {}) => ({
  spent: D(0), reserved: D(0), daily_spent: D(0), daily_reserved: D(0), unknown: 0n, ...changes,
});
const dto = (changes: Partial<AiSpendingDto> = {}): AiSpendingDto => ({
  enabled: true, economyEnabled: true, totalBudgetUsd: '1', dailyBudgetUsd: '0.03', reserveUsd: '0.4',
  startsAt: '2026-11-26T00:00:00+07:00', reserveFrom: '2026-12-12T00:00:00+07:00', endsAt: '2026-12-13T00:00:00+07:00',
  expectedRevision: 1, ...changes,
});

function fixture(options: { policy?: AiSpendPolicy | null; model?: AiModel; used?: ReturnType<typeof totals>; manager?: boolean; revoked?: boolean } = {}) {
  let currentPolicy = options.policy === undefined ? policy() : options.policy;
  let currentModel = options.model ?? model();
  const tx = {
    aiQuotaPolicy: { update: jest.fn(async () => ({})) },
    aiSpendPolicy: {
      findUnique: jest.fn(async () => currentPolicy),
      upsert: jest.fn(async ({ update }: { update: Partial<AiSpendPolicy> }) => {
        currentPolicy = { ...(currentPolicy ?? policy()), ...update };
        return currentPolicy;
      }),
    },
    aiModel: {
      findFirst: jest.fn(async () => currentModel),
      findMany: jest.fn(async () => [currentModel]),
      update: jest.fn(async ({ data }: { data: Partial<AiModel> }) => { currentModel = { ...currentModel, ...data }; return currentModel; }),
    },
    auditLog: { create: jest.fn(async () => ({})) },
    $queryRaw: jest.fn(async (..._args: unknown[]) => [options.used ?? totals()]),
  };
  const access = { actor: jest.fn(async (..._args: unknown[]) => {
    if (options.revoked) throw new ForbiddenException('Session revoked');
    return { grants: options.manager === false ? [{ group: 'MANAGER', scopeType: 'COURSE', permissions: ['ai:manage'] }]
      : [{ group: 'MANAGER', scopeType: 'SYSTEM', permissions: ['ai:manage'] }] };
  }) };
  const db = { ...tx, $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
  const service = new AiSpendingService(db as never, access as never);
  return { service, tx, db, access, transaction: tx as unknown as Prisma.TransactionClient };
}

describe('Shared AI spending admission', () => {
  it('defaults to economy without silently enabling monetary spending', async () => {
    const f = fixture({ policy: null });
    expect(await f.service.executionPolicy()).toEqual({ economyEnabled: true, spendingEnabled: false });
    expect(await f.service.reserve(f.transaction, model({ pricing_version: null }), 5000, now)).toBeNull();
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('uses confirmed model prices, the larger rate and upward rounding for a conservative reservation', () => {
    expect(reserveCost(model(), 5000)?.toString()).toBe('0.01');
    expect(reserveCost(model({ input_price: D('5'), output_price: D('1') }), 2000)?.toString()).toBe('0.01');
    expect(reserveCost(model({ input_price: D('0.00000001'), output_price: D('0') }), 1)?.toFixed()).toBe('0.00000001');
    expect(reserveCost(model({ input_price: D('0'), output_price: D('0') }), 5000)?.toString()).toBe('0');
    expect(() => reserveCost(model(), -1)).toThrow(BadRequestException);
    expect(() => reserveCost(model(), 0.5)).toThrow(BadRequestException);
  });

  it.each([
    { pricing_version: null }, { pricing_version: 'unconfirmed-price-list' }, { input_price: null },
    { output_price: null }, { input_price: D(-1) }, { output_price: D('NaN') },
  ])('does not treat missing or unconfirmed pricing as free: %j', async invalid => {
    const selected = model(invalid);
    expect(confirmedModelPricing(selected)).toBe(false);
    const f = fixture();
    await expect(f.service.reserve(f.transaction, selected, 5000, now)).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('counts other users and existing in-flight reservations against the pre-exam shared allowance', async () => {
    const f = fixture({ used: totals({ spent: D('0.4'), reserved: D('0.19') }) });
    expect((await f.service.reserve(f.transaction, model(), 5000, now))?.toString()).toBe('0.01');
    const blocked = fixture({ used: totals({ spent: D('0.4'), reserved: D('0.19000001') }) });
    await expect(blocked.service.reserve(blocked.transaction, model(), 5000, now)).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    const sql = (f.tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toContain('FROM ai_usage_records');
    expect(sql).toContain('reserved_cost_usd');
    expect(sql).not.toMatch(/user_id\s*=|deadline_at/); // Expired reservations and other owners cannot disappear from the total.
  });

  it('enforces the day allowance using both consumed and reserved costs', async () => {
    const exact = fixture({ used: totals({ daily_spent: D('0.01'), daily_reserved: D('0.01') }) });
    expect((await exact.service.reserve(exact.transaction, model(), 5000, now))?.toString()).toBe('0.01');
    const over = fixture({ used: totals({ daily_spent: D('0.01'), daily_reserved: D('0.01000001') }) });
    await expect(over.service.reserve(over.transaction, model(), 5000, now)).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
  });

  it('uses the Vietnam-day boundary rather than UTC midnight', async () => {
    const f = fixture();
    await f.service.reserve(f.transaction, model(), 5000, new Date('2026-11-27T18:30:00Z'));
    const dates = f.tx.$queryRaw.mock.calls[0].slice(1).filter(value => value instanceof Date) as Date[];
    expect(dates.filter(date => date.toISOString() === '2026-11-27T17:00:00.000Z')).toHaveLength(2);
  });

  it('releases the protected allowance on the exam date while keeping the total strict', async () => {
    const date = new Date('2026-12-11T17:00:00Z');
    expect(effectiveDailyBudget(policy(), date).toString()).toBe('0.4');
    const exact = fixture({ used: totals({ spent: D('0.6'), reserved: D('0.39'), daily_spent: D('0.39') }) });
    expect((await exact.service.reserve(exact.transaction, model(), 5000, date))?.toString()).toBe('0.01');
    const over = fixture({ used: totals({ spent: D('0.6'), reserved: D('0.39000001') }) });
    await expect(over.service.reserve(over.transaction, model(), 5000, date)).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
  });

  it.each(['2026-11-25T16:59:59Z', '2026-12-12T17:00:00Z'])('blocks dispatch outside the configured window: %s', async date => {
    const f = fixture();
    await expect(f.service.reserve(f.transaction, model(), 5000, new Date(date))).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('fails closed on an unpriced historical request, including an unknown failed dispatch', async () => {
    const f = fixture({ used: totals({ unknown: 1n }) });
    await expect(f.service.reserve(f.transaction, model(), 5000, now)).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    const sql = (f.tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toContain('amount IS NULL');
    expect(sql).not.toContain("status = 'completed'"); // Failed or interrupted dispatches remain charged conservatively.
  });
});

describe('Audited AI spending configuration', () => {
  it('reads only safe metadata with current SYSTEM authority and strips client scope', async () => {
    const f = fixture({ used: totals({ spent: D('0.1'), reserved: D('0.2'), unknown: 1n }) });
    const data = await f.service.status(actor);
    expect(data.configuration.revision).toBe(1);
    expect(data.usage).toMatchObject({ spentUsd: '0.1', reservedUsd: '0.2', remainingUsd: '0.7', costUnknown: true });
    expect(data.models[0]).toMatchObject({ id: model().id, inputPricePerMillion: '1', outputPricePerMillion: '2', pricesConfirmed: true });
    expect(JSON.stringify(data)).not.toMatch(/password|apiKey|Bearer|session-family|untrusted-course/);
    expect(f.access.actor).toHaveBeenCalledWith(f.tx, { ...actor, scopeCourseId: undefined }, 'ai:manage');
  });

  it.each([{ manager: false }, { revoked: true }])('rejects revoked or course-scoped authority before data/config mutations: %j', async authority => {
    const f = fixture(authority);
    await expect(f.service.status(actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.service.configure(actor, dto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.aiSpendPolicy.upsert).not.toHaveBeenCalled();
    expect(f.tx.aiModel.update).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('allows economy-only setup without enabling a USD guard or inventing prices', async () => {
    const f = fixture({ policy: null, model: model({ pricing_version: null, input_price: null, output_price: null }) });
    const data = await f.service.configure(actor, dto({ enabled: false, expectedRevision: 0 }));
    expect(data.configuration).toMatchObject({ enabled: false, economyEnabled: true, revision: 1 });
    expect(f.tx.aiModel.update).not.toHaveBeenCalled();
    expect(f.tx.aiQuotaPolicy.update).toHaveBeenCalledWith({ where: { id: 'default' }, data: { lock_version: { increment: 1 } } });
  });

  it('compares revision before writing policy or model prices', async () => {
    const f = fixture();
    await expect(f.service.configure(actor, dto({ expectedRevision: 0, modelId: model().id, inputPricePerMillion: '1', outputPricePerMillion: '2', pricesConfirmed: true })))
      .rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.aiSpendPolicy.upsert).not.toHaveBeenCalled();
    expect(f.tx.aiModel.update).not.toHaveBeenCalled();
  });

  it.each([
    { totalBudgetUsd: '0' }, { totalBudgetUsd: '1001' }, { totalBudgetUsd: '-1' },
    { dailyBudgetUsd: '0' }, { dailyBudgetUsd: '2' }, { reserveUsd: '1.1' },
    { reserveFrom: '2026-11-25T00:00:00+07:00' }, { endsAt: '2026-12-11T00:00:00+07:00' },
    { startsAt: 'not-a-date' }, { endsAt: '2028-12-13T00:00:00+07:00' },
  ])('rejects invalid monetary/window values before a transaction: %j', async invalid => {
    const f = fixture();
    await expect(f.service.configure(actor, dto(invalid))).rejects.toBeInstanceOf(BadRequestException);
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { modelId: model().id }, { inputPricePerMillion: '1', outputPricePerMillion: '2' },
    { modelId: model().id, inputPricePerMillion: '1', outputPricePerMillion: '2' },
    { modelId: model().id, inputPricePerMillion: '1', outputPricePerMillion: '2', pricesConfirmed: false },
  ])('requires a selected model, both prices and explicit confirmation: %j', async invalid => {
    const f = fixture();
    await expect(f.service.configure(actor, dto(invalid))).rejects.toBeInstanceOf(BadRequestException);
    expect(f.tx.aiModel.update).not.toHaveBeenCalled();
  });

  it('cannot enable a dollar budget while every model price is unknown', async () => {
    const f = fixture({ model: model({ pricing_version: null }) });
    await expect(f.service.configure(actor, dto())).rejects.toBeInstanceOf(BadRequestException);
    expect(f.tx.aiSpendPolicy.upsert).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('saves explicitly confirmed prices and policy in one audited transaction without provider calls', async () => {
    const f = fixture({ model: model({ input_price: null, output_price: null, pricing_version: null }) });
    const result = await f.service.configure(actor, dto({ modelId: model().id, inputPricePerMillion: '0.2', outputPricePerMillion: '0.8', pricesConfirmed: true }));
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.tx.aiModel.update).toHaveBeenCalledWith({ where: { id: model().id }, data: {
      input_price: D('0.2'), output_price: D('0.8'), pricing_version: expect.stringMatching(/^operator-confirmed:/),
    } });
    expect(result.configuration.revision).toBe(2);
    expect(result.models[0]).toMatchObject({ pricesConfirmed: true, inputPricePerMillion: '0.2', outputPricePerMillion: '0.8' });
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: {
      user_id: actor.id, action: 'ai.spending_policy_updated', resource: 'ai_spend_policy', resource_id: 'default',
      new_data: { revision: 2, enabled: true, economyEnabled: true, pricesUpdated: true },
    } });
  });

  it('enforces TLS before passing configuration to the service', () => {
    const service = { configure: jest.fn() };
    const vault = { assertTls: jest.fn(() => { throw new ForbiddenException(); }) };
    const controller = new AiSpendingController(service as never, vault as never);
    expect(() => controller.configure(actor, dto(), {} as never)).toThrow(ForbiddenException);
    expect(service.configure).not.toHaveBeenCalled();
  });
});

describe('Monetary reservation settlement', () => {
  function settlement() {
    const row = { id: 'usage', user_id: actor.id, status: 'reserved', reserved_tokens: 10000, charged_tokens: 10000,
      reserved_cost_usd: D('0.02'), started_at: now, input_price: D('1'), output_price: D('2'), pricing_version: 'operator-confirmed:fixture' };
    const tx = {
      aiQuotaPolicy: { update: jest.fn(async () => ({})) },
      aiUsageRecord: { findUniqueOrThrow: jest.fn(async () => row), update: jest.fn(async (_args: unknown) => ({})) },
      aiUsageBucket: { update: jest.fn(async () => ({})) },
    };
    const db = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    return { service: new AiQuotaService(db as never, {} as never), tx };
  }
  it('does not release a failed dispatched request when provider usage is missing', async () => {
    const f = settlement();
    await f.service.finish('usage', 'failed', null, 'AI_TIMEOUT');
    expect(f.tx.aiUsageRecord.update.mock.calls[0][0]).toMatchObject({ data: { estimated_cost: D('0.02'), charged_tokens: 10000 } });
  });
  it('releases the reservation only when the gateway confirms no provider dispatch occurred', async () => {
    const f = settlement();
    await f.service.finish('usage', 'failed', null, 'AI_MODEL_UNAVAILABLE', undefined, true);
    expect(f.tx.aiUsageRecord.update.mock.calls[0][0]).toMatchObject({ data: { estimated_cost: D('0'), charged_tokens: 0 } });
  });
  it('settles known token usage or a real provider cost while retaining the original reservation metadata', async () => {
    const f = settlement();
    await f.service.finish('usage', 'completed', { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
    expect(f.tx.aiUsageRecord.update.mock.calls[0][0]).toMatchObject({ data: { estimated_cost: D('0.002'), charged_tokens: 1500 } });
    expect(f.tx.aiUsageRecord.update.mock.calls[0][0]).not.toHaveProperty('data.reserved_cost_usd');
    const provider = settlement();
    await provider.service.finish('usage', 'completed', { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: '0.004' });
    expect(provider.tx.aiUsageRecord.update.mock.calls[0][0]).toMatchObject({ data: { estimated_cost: D('0.004') } });
  });
});
