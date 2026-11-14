import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AiGatewayController } from './ai-gateway.controller';
import { AiGatewayService } from './ai-gateway.service';
import { AiRegistryService } from './ai-registry.service';
import type { AiStreamEvent } from './ai.types';
import type { RequestUser } from '../../shared/sdk';

class SlowResponse extends EventEmitter {
  headersSent = false;
  destroyed = false;
  writableEnded = false;
  writes: string[] = [];
  blocked = true;
  status() {
    return this;
  }
  set() {
    return this;
  }
  flushHeaders() {
    this.headersSent = true;
  }
  write(chunk: string) {
    this.writes.push(chunk);
    return !this.blocked;
  }
  end(chunk?: string) {
    if (chunk) this.writes.push(chunk);
    this.writableEnded = true;
  }
}

describe('AI SSE response flow control', () => {
  const dto = { messages: [{ role: 'user' as const, content: 'Test' }] };
  const user = { id: 'test' } as RequestUser;
  it('awaits drain rather than consuming the next provider chunk while backpressured', async () => {
    let consumed = 0;
    const gateway = {
      async *stream(): AsyncGenerator<AiStreamEvent> {
        await Promise.resolve();
        consumed++;
        yield { type: 'text', data: { delta: 'first' } };
        consumed++;
        yield { type: 'end', data: { finishReason: 'completed' } };
      },
    };
    const controller = new AiGatewayController(
      gateway as unknown as AiGatewayService,
      {} as AiRegistryService,
      new ConfigService(),
    );
    const response = new SlowResponse();
    const task = controller.stream(user, dto, response as unknown as Response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(consumed).toBe(1);
    expect(response.writableEnded).toBe(false);
    response.blocked = false;
    response.emit('drain');
    await task;
    expect(consumed).toBe(2);
    expect(response.writableEnded).toBe(true);
    expect(response.listenerCount('close')).toBe(0);
  });
  it('aborts the shared provider signal and closes the generator when a blocked client disconnects', async () => {
    let closed = false;
    let signal: AbortSignal | undefined;
    const gateway = {
      async *stream(
        _user: RequestUser,
        _dto: unknown,
        abort: AbortSignal,
      ): AsyncGenerator<AiStreamEvent> {
        await Promise.resolve();
        signal = abort;
        try {
          yield { type: 'text', data: { delta: 'partial' } };
          yield { type: 'end', data: {} };
        } finally {
          closed = true;
        }
      },
    };
    const controller = new AiGatewayController(
      gateway as unknown as AiGatewayService,
      {} as AiRegistryService,
      new ConfigService(),
    );
    const response = new SlowResponse();
    const task = controller.stream(user, dto, response as unknown as Response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    response.destroyed = true;
    response.emit('close');
    await task;
    expect(signal?.aborted).toBe(true);
    expect(closed).toBe(true);
    expect(response.writes.join('')).not.toContain('event: end');
  });
});
