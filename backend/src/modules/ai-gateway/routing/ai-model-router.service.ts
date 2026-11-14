import { Injectable, Optional } from '@nestjs/common';
import type { AiAgentMode, AiModel } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { MetricsService } from '../../../metrics/metrics.service';
import { AiCircuitBreakerService } from '../ai-circuit-breaker.service';
import { normalizeVietnameseText } from '../rag/ai-rag.service';

export type RoutingLane = 'FAST_LANE' | 'REASONING_LANE' | 'AGENT_ACTION_LANE';

export interface RoutingDecision {
  lane: RoutingLane;
  routeVersion: string;
  riskClassification: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresTools: boolean;
  requiresConfirmationPolicy: boolean;
  complexityScore: number;
  selectedModelId?: string;
  selectedProviderId?: string;
  selectedUpstreamModel?: string;
  reason: string;
}

const ACTION_OR_LIVE_METRIC_PATTERNS =
  /\b(?:thong\s+ke|so\s+lieu|bao\s+nhieu|how\s+many|count|tong\s+quan|overview|dashboard|phe\s+duyet|pending\s+approval|yeu\s+cau\s+cho|ai\s+usage|chi\s+phi|cost|provider\s+status|trang\s+thai\s+provider|canh\s+bao|alert|health|suc\s+khoe|nhat\s+ky|audit|tao\s+ban\s+nhap|create\s+draft|propose|de\s+xuat|chuan\s+bi\s+thong\s+bao|announcement|ghi\s+chu\s+quan\s+tri|admin\s+note|cap\s+nhat\s+khoa\s+hoc|update\s+course|xuat\s+ban\s+khoa\s+hoc|publish\s+course|tim\s+khoa\s+hoc|search\s+course|tien\s+do|progress|submission|quiz\s+result)\b/i;

const MUTATION_PATTERNS =
  /\b(?:tao\s+ban\s+nhap|create\s+draft|de\s+xuat\s+khoa\s+hoc|chuan\s+bi\s+thong\s+bao|prepare\s+announcement|ghi\s+chu\s+quan\s+tri|admin\s+note|cap\s+nhat\s+khoa\s+hoc|update\s+course|xuat\s+ban\s+khoa\s+hoc|publish\s+course)\b/i;

const REASONING_PATTERNS =
  /\b(?:phan\s+tich\s+chuyen\s+sau|so\s+sanh|tong\s+hop|chien\s+luoc|ke\s+hoach\s+chi\s+tiet|nguyen\s+nhan\s+goc|root\s+cause|multi-step|synthesis|architecture\s+tradeoff|danh\s+gia\s+rui\s+ro|toi\s+uu\s+hoa\s+he\s+thong)\b/i;

@Injectable()
export class AiModelRouterService {
  private readonly routeVersion = 'router-v1.0.0';
  private readonly recentDecisions: Array<
    RoutingDecision & { mode: AiAgentMode; timestamp: string }
  > = [];

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly circuitBreaker?: AiCircuitBreakerService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  getRouteVersion(): string {
    return this.routeVersion;
  }

  classifyRequest(options: {
    message: string;
    mode: AiAgentMode;
    hasActiveTools: boolean;
  }): Omit<RoutingDecision, 'selectedModelId' | 'selectedProviderId' | 'selectedUpstreamModel'> {
    const normalized = normalizeVietnameseText(options.message);
    const wordCount = normalized.split(' ').filter(Boolean).length;
    const isMutation = MUTATION_PATTERNS.test(normalized);
    const needsTools = isMutation || ACTION_OR_LIVE_METRIC_PATTERNS.test(normalized);
    const isComplexReasoning =
      REASONING_PATTERNS.test(normalized) || wordCount >= 45 || options.message.includes('\n');

    // 1. Security / risk classification first & 2. Tool requirements second
    if (isMutation) {
      return {
        lane: 'AGENT_ACTION_LANE',
        routeVersion: this.routeVersion,
        riskClassification: 'HIGH',
        requiresTools: true,
        requiresConfirmationPolicy: true,
        complexityScore: 3,
        reason: 'Administrative mutation or proposal requires Tool Registry, RBAC and confirmation policy',
      };
    }

    if (needsTools && options.hasActiveTools) {
      return {
        lane: 'AGENT_ACTION_LANE',
        routeVersion: this.routeVersion,
        riskClassification: options.mode === 'MANAGEMENT' ? 'MEDIUM' : 'LOW',
        requiresTools: true,
        requiresConfirmationPolicy: options.mode === 'MANAGEMENT',
        complexityScore: 2,
        reason: 'Live system query or operational verification requires authorized backend tools',
      };
    }

    // 3. Task complexity third
    if (isComplexReasoning) {
      return {
        lane: 'REASONING_LANE',
        routeVersion: this.routeVersion,
        riskClassification: 'LOW',
        requiresTools: false,
        requiresConfirmationPolicy: false,
        complexityScore: 3,
        reason: 'Multi-step synthesis, architectural analysis or complex planning detected',
      };
    }

    return {
      lane: 'FAST_LANE',
      routeVersion: this.routeVersion,
      riskClassification: 'LOW',
      requiresTools: false,
      requiresConfirmationPolicy: false,
      complexityScore: 1,
      reason: 'Short low-risk informational or document-grounded explanation suitable for economical model',
    };
  }

  async route(options: {
    message: string;
    mode: AiAgentMode;
    explicitModelId?: string;
    hasActiveTools: boolean;
    hasPremiumPermission: boolean;
  }): Promise<RoutingDecision> {
    const base = this.classifyRequest({
      message: options.message,
      mode: options.mode,
      hasActiveTools: options.hasActiveTools,
    });

    const candidates = await this.prisma.aiModel.findMany({
      where: {
        enabled: true,
        provider: { enabled: true },
        ...(!options.hasPremiumPermission ? { premium: false } : {}),
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
    });

    const healthyCandidates: AiModel[] = [];
    for (const model of candidates) {
      if (this.circuitBreaker) {
        const admission = await this.circuitBreaker.checkAdmission(model.provider_id);
        if (!admission.allowed) continue;
      }
      healthyCandidates.push(model);
    }
    const pool = healthyCandidates.length ? healthyCandidates : candidates;

    let chosen: AiModel | undefined;
    if (options.explicitModelId) {
      chosen = pool.find((m) => m.id === options.explicitModelId);
    }

    if (!chosen && pool.length) {
      if (base.lane === 'AGENT_ACTION_LANE') {
        chosen =
          pool.find((m) => m.capabilities.includes('tools') && m.allowed_tools.length > 0) ??
          pool.find((m) => m.is_default) ??
          pool[0];
      } else if (base.lane === 'REASONING_LANE') {
        chosen =
          pool.find((m) => m.capabilities.includes('reasoning_context')) ??
          pool.find((m) => m.context_tokens >= 32000) ??
          pool.find((m) => m.is_default) ??
          pool[0];
      } else {
        // FAST_LANE prefers economical models when pricing is configured, or default model
        const withPrice = pool
          .filter((m) => m.input_price !== null)
          .sort((a, b) => Number(a.input_price) - Number(b.input_price));
        chosen = withPrice[0] ?? pool.find((m) => m.is_default) ?? pool[0];
      }
    }

    const decision: RoutingDecision = {
      ...base,
      selectedModelId: chosen?.id ?? options.explicitModelId,
      selectedProviderId: chosen?.provider_id,
      selectedUpstreamModel: chosen?.model_id,
    };

    this.metrics?.aiLaneRequests.inc({ lane: decision.lane, mode: options.mode });
    this.recentDecisions.push({
      ...decision,
      mode: options.mode,
      timestamp: new Date().toISOString(),
    });
    if (this.recentDecisions.length > 100) {
      this.recentDecisions.shift();
    }

    return decision;
  }

  getRoutingSummary() {
    const counts: Record<RoutingLane, number> = {
      FAST_LANE: 0,
      REASONING_LANE: 0,
      AGENT_ACTION_LANE: 0,
    };
    for (const d of this.recentDecisions) {
      counts[d.lane] = (counts[d.lane] ?? 0) + 1;
    }
    return {
      routeVersion: this.routeVersion,
      lanes: [
        {
          lane: 'FAST_LANE',
          description:
            'Giải thích ngắn gọn, điều hướng chung và câu hỏi thông tin rủi ro thấp dựa trên tài liệu RAG.',
          requests: counts.FAST_LANE,
        },
        {
          lane: 'REASONING_LANE',
          description:
            'Phân tích đa bước, tổng hợp nhiều tài liệu và lập kế hoạch vận hành/kỹ thuật chuyên sâu.',
          requests: counts.REASONING_LANE,
        },
        {
          lane: 'AGENT_ACTION_LANE',
          description:
            'Truy vấn số liệu quản trị thời gian thực và tạo đề xuất hành động có kiểm soát RBAC + xác nhận.',
          requests: counts.AGENT_ACTION_LANE,
        },
      ],
      recentDecisions: this.recentDecisions.slice(-20).reverse(),
    };
  }
}
