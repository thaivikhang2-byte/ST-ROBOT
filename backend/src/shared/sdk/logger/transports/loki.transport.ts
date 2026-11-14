// ═══════════════════════════════════════════
// Logger SDK — Loki Transport (stub)
// ═══════════════════════════════════════════

import { ILogTransport, LogEntry } from './transport.interface';

/**
 * Grafana Loki log transport.
 * Pushes log entries to Loki for centralized log aggregation.
 *
 * TODO: Implement in Phase 13 (Monitoring)
 * - Loki push API integration
 * - Label-based log streams
 * - Batch buffering
 */
export class LokiTransport implements ILogTransport {
  readonly name = 'loki';

  log(entry: LogEntry): void {
    // Stub — will push to Loki
  }

  error(entry: LogEntry): void {
    // Stub
  }

  warn(entry: LogEntry): void {
    // Stub
  }

  debug(entry: LogEntry): void {
    // Stub
  }

  verbose(entry: LogEntry): void {
    // Stub
  }
}
