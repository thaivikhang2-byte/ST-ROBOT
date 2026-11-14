// ═══════════════════════════════════════════
// Logger SDK — Console Transport
// ═══════════════════════════════════════════

import { ILogTransport, LogEntry } from './transport.interface';

export class ConsoleTransport implements ILogTransport {
  readonly name = 'console';

  log(entry: LogEntry): void {
    console.log(this.format(entry));
  }

  error(entry: LogEntry): void {
    console.error(this.format(entry));
  }

  warn(entry: LogEntry): void {
    console.warn(this.format(entry));
  }

  debug(entry: LogEntry): void {
    console.debug(this.format(entry));
  }

  verbose(entry: LogEntry): void {
    console.log(this.format(entry));
  }

  private format(entry: LogEntry): string {
    return JSON.stringify(entry);
  }
}
