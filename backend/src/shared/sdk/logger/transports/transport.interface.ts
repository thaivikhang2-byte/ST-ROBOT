// ═══════════════════════════════════════════
// Logger SDK — Transport Interface
// ═══════════════════════════════════════════

export interface LogEntry {
  level: 'error' | 'warn' | 'info' | 'debug' | 'verbose';
  message: string;
  context?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  traceId?: string;
}

export interface ILogTransport {
  readonly name: string;

  log(entry: LogEntry): void;
  error(entry: LogEntry): void;
  warn(entry: LogEntry): void;
  debug(entry: LogEntry): void;
  verbose(entry: LogEntry): void;
}
