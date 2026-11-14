// ═══════════════════════════════════════════
// Events SDK — Base Event
// ═══════════════════════════════════════════

import { IDomainEvent } from './interfaces/domain-event.interface';

export abstract class BaseDomainEvent implements IDomainEvent {
  public readonly occurredAt: Date;

  constructor(
    public readonly eventName: string,
    public readonly payload: Record<string, unknown>,
    public readonly userId?: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    this.occurredAt = new Date();
  }
}
