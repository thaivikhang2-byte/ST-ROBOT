// ═══════════════════════════════════════════
// Logger SDK — Logger Service
// ═══════════════════════════════════════════

import {
  Injectable,
  LoggerService as NestLoggerService,
  Scope,
  Inject,
  Optional,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { loggingConfig } from '../../../config/configurations';
import { currentContext } from './request-context';
import { redact } from './redaction';
import { ILogTransport, LogEntry } from './transports/transport.interface';
import { ConsoleTransport } from './transports/console.transport';

@Injectable({ scope: Scope.TRANSIENT })
export class AppLoggerService implements NestLoggerService {
  private transports: ILogTransport[] = [];
  private context = '';

  constructor(
    @Optional()
    @Inject(loggingConfig.KEY)
    private readonly settings?: ConfigType<typeof loggingConfig>,
  ) {
    // Default transport
    this.transports.push(new ConsoleTransport());
  }

  setContext(context: string): this {
    this.context = context;
    return this;
  }

  addTransport(transport: ILogTransport): this {
    this.transports.push(transport);
    return this;
  }

  log(message: string, context?: string): void {
    this.dispatch('info', message, context);
  }

  error(message: string, trace?: string, context?: string): void {
    this.dispatch('error', message, context, { errorClass: 'ApplicationError' });
  }

  warn(message: string, context?: string): void {
    this.dispatch('warn', message, context);
  }

  debug(message: string, context?: string): void {
    this.dispatch('debug', message, context);
  }

  verbose(message: string, context?: string): void {
    this.dispatch('verbose', message, context);
  }

  event(level: LogEntry['level'], operation: string, metadata: Record<string, unknown> = {}) {
    this.dispatch(level, operation, undefined, { operation, ...metadata });
  }

  private dispatch(
    level: LogEntry['level'],
    message: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const ranks = { verbose: 0, debug: 1, info: 2, warn: 3, error: 4 };
    const configured = this.settings?.level === 'log' ? 'info' : this.settings?.level;
    if (ranks[level] < (ranks[configured as keyof typeof ranks] ?? 2)) return;
    const contextIds = currentContext();
    const entry: LogEntry = redact(
      {
        level,
        message,
        context: context || this.context,
        timestamp: new Date().toISOString(),
        metadata: { service: 'st-robot-backend', ...metadata, requestId: contextIds?.requestId },
        traceId: contextIds?.traceId,
      },
      this.settings?.secrets,
    );

    for (const transport of this.transports) {
      transport[level === 'info' ? 'log' : level](entry);
    }
  }
}
