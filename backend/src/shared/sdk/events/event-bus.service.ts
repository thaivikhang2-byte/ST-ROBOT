// ═══════════════════════════════════════════
// Events SDK — Event Bus Service
// Type-safe wrapper around NestJS EventEmitter
// ═══════════════════════════════════════════

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IDomainEvent } from './interfaces/domain-event.interface';

@Injectable()
export class EventBusService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Emit a domain event.
   * All registered handlers for this event name will be notified.
   */
  emit(event: IDomainEvent): boolean {
    return this.eventEmitter.emit(event.eventName, event);
  }

  /**
   * Emit a domain event and wait for all handlers to complete.
   */
  async emitAsync(event: IDomainEvent): Promise<unknown[]> {
    return this.eventEmitter.emitAsync(event.eventName, event);
  }
}
