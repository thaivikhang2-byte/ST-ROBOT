import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';

export interface TraceContext {
  requestId: string;
  traceId: string;
  spanId: string;
}
const local = new AsyncLocalStorage<TraceContext>();
export function makeContext(requestId?: string, traceparent?: string): TraceContext {
  const trace = /^00-([a-f0-9]{32})-([a-f0-9]{16})-0[01]$/.exec(traceparent ?? '');
  return {
    requestId: /^[a-f0-9-]{36}$/i.test(requestId ?? '') ? requestId! : randomUUID(),
    traceId:
      trace && !/^0+$/.test(trace[1]) && !/^0+$/.test(trace[2])
        ? trace[1]
        : randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
  };
}
export const currentContext = () => local.getStore();
export function withContext<T>(context: TraceContext | undefined, run: () => T): T {
  const safe = context
    ? makeContext(context.requestId, `00-${context.traceId}-${context.spanId}-01`)
    : makeContext();
  return local.run(safe, run);
}
export function queuedContext(): { _trace?: TraceContext } {
  const context = currentContext();
  return context ? { _trace: { ...context } } : {};
}
export function traceHeaders(): Record<string, string> {
  const c = currentContext();
  return c ? { 'X-Request-ID': c.requestId, traceparent: `00-${c.traceId}-${c.spanId}-01` } : {};
}
