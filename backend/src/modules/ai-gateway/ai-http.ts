import { once } from 'node:events';
import type { Response } from 'express';
import { AiError } from './ai.error';
import type { AiStreamEvent } from './ai.types';

export function aiConnection(response: Response, timeoutMs: number) {
  const disconnect = new AbortController();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort('timeout'), timeoutMs);
  timer.unref();
  const closed = () => {
    if (!response.writableEnded) disconnect.abort('disconnect');
  };
  response.once('close', closed);
  return {
    signal: AbortSignal.any([disconnect.signal, timeout.signal]),
    close: () => {
      clearTimeout(timer);
      response.off('close', closed);
    },
  };
}
export async function sendAiStream(
  response: Response,
  events: AsyncIterable<AiStreamEvent>,
  signal: AbortSignal,
) {
  try {
    for await (const event of events) {
      if (signal.aborted || response.destroyed) break;
      if (!response.headersSent) {
        response.status(200).set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        });
        response.flushHeaders();
      }
      if (!response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`))
        await once(response, 'drain', { signal });
    }
    if (!response.destroyed) response.end();
  } catch (error) {
    if (!response.headersSent) throw error;
    if (!response.destroyed)
      response.end(
        `event: error\ndata: ${JSON.stringify(error instanceof AiError ? error.getResponse() : { success: false, message: 'AI stream interrupted' })}\n\n`,
      );
  }
}
