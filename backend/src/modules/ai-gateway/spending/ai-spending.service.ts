import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { AiModel, AiSpendPolicy, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type { RequestUser } from '../../../shared/sdk';
import { ErrorCode } from '../../../shared/sdk/errors/error-codes.enum';
import { LearningAccessService } from '../../progress/learning-access.service';
import { AiError } from '../ai.error';
import { AiSpendingDto } from './ai-spending.dto';

const ZERO = new Prisma.Decimal(0);
const confirmedPrefix = 'operator-confirmed:';
const nonnegative = (value: Prisma.Decimal | null | undefined) => value !== null && value !== undefined && value.isFinite() && value.gte(0);
const clamp = (value: Prisma.Decimal) => Prisma.Decimal.max(ZERO, value);
const dayStart = (now: Date) => new Date(Math.floor((now.getTime() + 7 * 3600000) / 86400000) * 86400000 - 7 * 3600000);
const denied = (message: string): never => { throw new AiError(ErrorCode.AI_QUOTA_EXCEEDED, 429, message); };

interface Totals {
  spent: Prisma.Decimal; reserved: Prisma.Decimal;
  daily_spent: Prisma.Decimal; daily_reserved: Prisma.Decimal; unknown: bigint;
}

export function confirmedModelPricing(model: Pick<AiModel, 'input_price' | 'output_price' | 'pricing_version'>) {
  return Boolean(model.pricing_version?.startsWith(confirmedPrefix) && nonnegative(model.input_price) && nonnegative(model.output_price));
}

/** This bound deliberately prices every reserved token at the larger rate. */
export function reserveCost(model: Pick<AiModel, 'input_price' | 'output_price' | 'pricing_version'>, tokens: number) {
  if (!confirmedModelPricing(model)) return null;
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new BadRequestException('Giới hạn token không hợp lệ.');
  return new Prisma.Decimal(tokens).mul(Prisma.Decimal.max(model.input_price!, model.output_price!))
    .div(1000000).toDecimalPlaces(8, Prisma.Decimal.ROUND_UP);
}

export function effectiveDailyBudget(policy: AiSpendPolicy, now: Date) {
  return now >= policy.reserve_from ? Prisma.Decimal.max(policy.daily_budget_usd, policy.reserve_usd) : policy.daily_budget_usd;
}

/** All admissions/config changes take the existing default quota row lock first. */
@Injectable()
export class AiSpendingService {
  constructor(private readonly db: PrismaService, private readonly access: LearningAccessService) {}

  async executionPolicy() {
    const row = await this.db.aiSpendPolicy.findUnique({ where: { id: 'default' } });
    return { economyEnabled: row?.economy_enabled ?? true, spendingEnabled: row?.enabled ?? false };
  }

  private async administrator(tx: Prisma.TransactionClient, actor: RequestUser) {
    const current = await this.access.actor(tx, { ...actor, scopeCourseId: undefined }, 'ai:manage');
    if (!current.grants.some(grant => grant.group === 'MANAGER' && grant.scopeType === 'SYSTEM' && grant.permissions.includes('ai:manage')))
      throw new ForbiddenException('Verified SYSTEM AI manager authority required');
  }

  private async totals(tx: Prisma.TransactionClient, policy: AiSpendPolicy, now: Date): Promise<Totals> {
    const [row] = await tx.$queryRaw<Totals[]>`
      WITH amounts AS (
        SELECT status, started_at,
          CASE WHEN status = 'reserved' THEN COALESCE(reserved_cost_usd,
            CASE WHEN pricing_version IS NOT NULL AND input_price >= 0 AND output_price >= 0
              THEN reserved_tokens::numeric * GREATEST(input_price, output_price) / 1000000 END)
          ELSE COALESCE(estimated_cost, reserved_cost_usd,
            CASE WHEN pricing_version IS NOT NULL AND input_price >= 0 AND output_price >= 0
              THEN CASE WHEN input_tokens >= 0 AND output_tokens >= 0
                THEN (input_tokens::numeric * input_price + output_tokens::numeric * output_price) / 1000000
                ELSE GREATEST(reserved_tokens, charged_tokens)::numeric * GREATEST(input_price, output_price) / 1000000 END END)
          END AS amount
        FROM ai_usage_records
        WHERE started_at >= ${policy.starts_at} AND started_at < ${policy.ends_at}
      )
      SELECT COALESCE(SUM(amount) FILTER (WHERE status <> 'reserved'), 0) AS spent,
        COALESCE(SUM(amount) FILTER (WHERE status = 'reserved'), 0) AS reserved,
        COALESCE(SUM(amount) FILTER (WHERE status <> 'reserved' AND started_at >= ${dayStart(now)}), 0) AS daily_spent,
        COALESCE(SUM(amount) FILTER (WHERE status = 'reserved' AND started_at >= ${dayStart(now)}), 0) AS daily_reserved,
        COUNT(*) FILTER (WHERE amount IS NULL OR amount < 0) AS unknown
      FROM amounts`;
    return row ?? { spent: ZERO, reserved: ZERO, daily_spent: ZERO, daily_reserved: ZERO, unknown: 0n };
  }

  /** Called inside AiQuotaService's serialized admission, before any provider I/O. */
  async reserve(tx: Prisma.TransactionClient, model: AiModel, tokens: number, now: Date) {
    const policy = await tx.aiSpendPolicy.findUnique({ where: { id: 'default' } });
    const amount = reserveCost(model, tokens);
    if (!policy?.enabled) return amount;
    if (now < policy.starts_at || now >= policy.ends_at) denied('Đã ngoài thời gian sử dụng ngân sách AI đã đặt.');
    if (amount === null) denied('Chưa có giá model đã xác nhận. Admin cần kiểm tra bảng giá trước khi dùng ngân sách AI.');
    const used = await this.totals(tx, policy, now);
    if (used.unknown > 0n) denied('Có lượt AI chưa xác định được chi phí. Cần đối soát trước khi dùng tiếp ngân sách.');
    const availableTotal = now < policy.reserve_from ? policy.total_budget_usd.sub(policy.reserve_usd) : policy.total_budget_usd;
    if (used.spent.add(used.reserved).add(amount!).gt(availableTotal))
      denied(now < policy.reserve_from ? 'Đã dùng hết phần ngân sách AI trước ngày thi; phần dự phòng được giữ nguyên.' : 'Đã đạt ngân sách AI đã đặt.');
    if (used.daily_spent.add(used.daily_reserved).add(amount!).gt(effectiveDailyBudget(policy, now)))
      denied('Đã đạt ngân sách AI hôm nay. Hạn mức tính theo giờ Việt Nam.');
    return amount;
  }

  private configuration(row: AiSpendPolicy | null) {
    return {
      revision: row?.revision ?? 0, enabled: row?.enabled ?? false, economyEnabled: row?.economy_enabled ?? true,
      totalBudgetUsd: row?.total_budget_usd.toFixed() ?? '1', dailyBudgetUsd: row?.daily_budget_usd.toFixed() ?? '0.03',
      reserveUsd: row?.reserve_usd.toFixed() ?? '0.4', startsAt: row?.starts_at.toISOString() ?? null,
      reserveFrom: row?.reserve_from.toISOString() ?? null, endsAt: row?.ends_at.toISOString() ?? null,
    };
  }

  private async metadata(tx: Prisma.TransactionClient, now = new Date()) {
    const policy = await tx.aiSpendPolicy.findUnique({ where: { id: 'default' } });
    const configuration = this.configuration(policy);
    const used = policy ? await this.totals(tx, policy, now) : { spent: ZERO, reserved: ZERO, daily_spent: ZERO, daily_reserved: ZERO, unknown: 0n };
    const total = new Prisma.Decimal(configuration.totalBudgetUsd);
    const daily = policy ? effectiveDailyBudget(policy, now) : new Prisma.Decimal(configuration.dailyBudgetUsd);
    const models = await tx.aiModel.findMany({ where: { enabled: true, provider: { enabled: true } },
      select: { id: true, provider_id: true, model_id: true, input_price: true, output_price: true, pricing_version: true } });
    return {
      configuration,
      usage: { spentUsd: used.spent.toFixed(), reservedUsd: used.reserved.toFixed(),
        remainingUsd: clamp(total.sub(used.spent).sub(used.reserved)).toFixed(),
        dailyRemainingUsd: clamp(daily.sub(used.daily_spent).sub(used.daily_reserved)).toFixed(),
        effectiveDailyBudgetUsd: daily.toFixed(), costUnknown: used.unknown > 0n },
      models: models.map(model => ({ id: model.id, providerId: model.provider_id, modelId: model.model_id,
        inputPricePerMillion: model.input_price?.toFixed() ?? null, outputPricePerMillion: model.output_price?.toFixed() ?? null,
        pricingVersion: model.pricing_version, pricesConfirmed: confirmedModelPricing(model) })),
      notice: 'Giới hạn dùng chung cho toàn website, tính theo giá model admin đã xác nhận; không phải số dư ví Woku. Ngày tính theo giờ Việt Nam. Chi phí chưa rõ vẫn giữ mức dự phòng; không coi là miễn phí.',
    };
  }

  async status(actor: RequestUser) {
    return this.db.$transaction(async tx => { await this.administrator(tx, actor); return this.metadata(tx); });
  }

  async configure(actor: RequestUser, dto: AiSpendingDto) {
    const decimal = (value: string) => {
      if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,8})?$/.test(value)) throw new BadRequestException('Giá trị USD không hợp lệ.');
      return new Prisma.Decimal(value);
    };
    const total = decimal(dto.totalBudgetUsd), daily = decimal(dto.dailyBudgetUsd), reserve = decimal(dto.reserveUsd);
    const startsAt = new Date(dto.startsAt), reserveFrom = new Date(dto.reserveFrom), endsAt = new Date(dto.endsAt);
    if (!total.gt(0) || total.gt(1000) || !daily.gt(0) || daily.gt(total) || reserve.gt(total)
        || ![startsAt, reserveFrom, endsAt].every(date => Number.isFinite(date.getTime())) || !(startsAt < reserveFrom && reserveFrom < endsAt)
        || endsAt.getTime() - startsAt.getTime() > 366 * 86400000)
      throw new BadRequestException('Kiểm tra ngân sách tổng, hạn mức ngày và thời gian dự phòng.');
    const priceUpdate = dto.modelId !== undefined || dto.inputPricePerMillion !== undefined || dto.outputPricePerMillion !== undefined;
    if (priceUpdate && (!dto.modelId || dto.inputPricePerMillion === undefined || dto.outputPricePerMillion === undefined || dto.pricesConfirmed !== true))
      throw new BadRequestException('Cần chọn model, nhập cả hai mức giá và xác nhận đã kiểm tra bảng giá.');
    const input = priceUpdate ? decimal(dto.inputPricePerMillion!) : null;
    const output = priceUpdate ? decimal(dto.outputPricePerMillion!) : null;
    return this.db.$transaction(async tx => {
      await tx.aiQuotaPolicy.update({ where: { id: 'default' }, data: { lock_version: { increment: 1 } } });
      await this.administrator(tx, actor);
      const previous = await tx.aiSpendPolicy.findUnique({ where: { id: 'default' } });
      if ((previous?.revision ?? 0) !== dto.expectedRevision) throw new ConflictException('Cấu hình ngân sách đã thay đổi; tải lại trước khi lưu.');
      if (priceUpdate) {
        const model = await tx.aiModel.findFirst({ where: { id: dto.modelId, enabled: true, provider: { enabled: true } } });
        if (!model) throw new BadRequestException('Chọn model đang bật để xác nhận giá.');
        await tx.aiModel.update({ where: { id: model.id }, data: { input_price: input, output_price: output,
          pricing_version: confirmedPrefix + new Date().toISOString() } });
      }
      if (dto.enabled && !(await tx.aiModel.findMany({ where: { enabled: true, provider: { enabled: true } } })).some(confirmedModelPricing))
        throw new BadRequestException('Chưa có model với giá đã xác nhận. Kiểm tra bảng giá trước khi bật ngân sách USD.');
      const data = { enabled: dto.enabled, economy_enabled: dto.economyEnabled, total_budget_usd: total, daily_budget_usd: daily,
        reserve_usd: reserve, starts_at: startsAt, reserve_from: reserveFrom, ends_at: endsAt,
        revision: dto.expectedRevision + 1, updated_by_id: actor.id };
      await tx.aiSpendPolicy.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
      await tx.auditLog.create({ data: { user_id: actor.id, action: 'ai.spending_policy_updated', resource: 'ai_spend_policy', resource_id: 'default',
        new_data: { revision: data.revision, enabled: data.enabled, economyEnabled: data.economy_enabled, pricesUpdated: priceUpdate } } });
      return this.metadata(tx);
    });
  }
}
