// ═══════════════════════════════════════════
// Logger SDK — File Transport (stub)
// ═══════════════════════════════════════════

import { ILogTransport, LogEntry } from './transport.interface';

/**
 * File-based log transport.
 * Writes log entries to rotating log files.
 *
 * TODO: Implement in Phase 13 (Monitoring)
 * - Rotating file strategy
 * - Max file size / max files
 * - Async write buffer
 */
export class FileTransport implements ILogTransport {
  readonly name = 'file';

  log(entry: LogEntry): void {
    // Stub — will write to file
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
