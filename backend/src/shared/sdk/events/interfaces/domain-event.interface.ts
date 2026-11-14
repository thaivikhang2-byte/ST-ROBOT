// ═══════════════════════════════════════════
// Events SDK — Domain Event Interface
// ═══════════════════════════════════════════

export interface IDomainEvent {
  readonly eventName: string;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
  readonly userId?: string;
  readonly metadata?: Record<string, unknown>;
}
