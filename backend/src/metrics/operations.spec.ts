import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { MetricsService } from './metrics.service';
import { MetricsGuard } from './metrics.guard';
import {
  makeContext,
  withContext,
  currentContext,
  queuedContext,
} from '../shared/sdk/logger/request-context';
import { redact } from '../shared/sdk/logger/redaction';
import {
  backupKey,
  encryptStream,
  verifyEncrypted,
  decryptStream,
} from '../modules/backup/backup-crypto';
import { AppLoggerService } from '../shared/sdk/logger/logger.service';
import type { ConfigType } from '@nestjs/config';
import { operationsConfig } from '../config/configurations';
import { ExecutionContext } from '@nestjs/common';

describe('Phase12 operational security primitives', () => {
  test('isolated registries include counters and bounded real request window', async () => {
    const a = new MetricsService(),
      b = new MetricsService();
    a.record('GET', '/api/v1/users/:id', 500, 0.2, 'request-id', 'trace-id');
    expect(a.summary()).toMatchObject({ total: 1, errors: 1, errorRate: 1, p95Seconds: 0.2 });
    expect(b.summary().total).toBe(0);
    expect(await a.getMetrics()).toContain('path="/api/v1/users/:id"');
    a.onModuleDestroy();
    b.onModuleDestroy();
  });
  test('worker executions record real success/failure without swallowing errors', async () => {
    const metrics = new MetricsService();
    expect(await metrics.job('video-processing', () => Promise.resolve(7))).toBe(7);
    await expect(
      metrics.job('video-processing', () => Promise.reject(new Error('failure'))),
    ).rejects.toThrow('failure');
    const text = await metrics.getMetrics();
    expect(text).toContain('queue="video-processing",status="completed"} 1');
    expect(text).toContain('queue="video-processing",status="failed"} 1');
    metrics.onModuleDestroy();
  });
  test('scrape credentials fail closed and handle multibyte tokens safely', () => {
    const token = 'a'.repeat(32),
      guard = new MetricsGuard({ metricsToken: token } as ConfigType<typeof operationsConfig>);
    const context = (authorization: string) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
      }) as ExecutionContext;
    expect(() => guard.canActivate(context('Bearer ' + '界'.repeat(32)))).toThrow();
    expect(() => guard.canActivate(context(''))).toThrow();
    expect(guard.canActivate(context('Bearer ' + token))).toBe(true);
    expect(() =>
      new MetricsGuard({ metricsToken: '' } as ConfigType<typeof operationsConfig>).canActivate(
        context('Bearer '),
      ),
    ).toThrow();
  });
  test('concurrent contexts keep independent request IDs and propagate to queued jobs', async () => {
    await Promise.all(
      [1, 2].map(async (n) => {
        const c = makeContext();
        await withContext(c, async () => {
          await new Promise((r) => setTimeout(r, n));
          expect(currentContext()?.requestId).toBe(c.requestId);
          expect(queuedContext()._trace?.traceId).toBe(c.traceId);
        });
      }),
    );
    expect(currentContext()).toBeUndefined();
    expect(queuedContext()).toEqual({});
    expect(makeContext('malicious\nheader').requestId).not.toBe('malicious\nheader');
  });
  test('structured logs redact credentials, email, JWT and conversation bodies', () => {
    const out = redact(
      {
        password: 'unsafe',
        headers: { authorization: 'Bearer abc' },
        prompt: 'private student text',
        input_tokens: 20,
        message:
          'user@example.com AIza012345678901234567890123456789012345 sk-abcdefghi0123456789abcdefghi',
        nested: { secret: 'unsafe' },
        other: 'configured-private-secret',
      },
      ['configured-private-secret'],
    );
    const serialized = JSON.stringify(out);
    for (const value of [
      'unsafe',
      'private student text',
      'user@example.com',
      'configured-private-secret',
      'sk-abcdef',
    ])
      expect(serialized).not.toContain(value);
    expect(out.input_tokens).toBe(20);
    const logger = new AppLoggerService();
    const capture = jest.fn<
      void,
      [import('../shared/sdk/logger/transports/transport.interface').LogEntry]
    >();
    logger.addTransport({
      name: 'test-capture',
      log: capture,
      warn: capture,
      error: capture,
      debug: capture,
      verbose: capture,
    });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    withContext(makeContext(), () =>
      logger.event('info', 'sample.operation', { durationMs: 1, status: 200, password: 'private' }),
    );
    expect(capture.mock.calls[0][0]).toMatchObject({
      level: 'info',
      message: 'sample.operation',
      metadata: { operation: 'sample.operation', password: '[REDACTED]', status: 200 },
    });
    expect(
      (JSON.parse(consoleSpy.mock.calls[0][0] as string) as { traceId: string }).traceId,
    ).toMatch(/^[a-f0-9]{32}$/);
    consoleSpy.mockRestore();
  });
  test('encrypted backup roundtrip, corruption, key mismatch and size limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'st-robot-phase12-')),
      key = randomBytes(32),
      path = join(dir, 'snapshot.enc');
    try {
      const part = await encryptStream(Readable.from('real-private-fixture'), path, key, 1024);
      expect(await verifyEncrypted(path, key, part.sha256)).toBe(20);
      let text = '';
      for await (const chunk of await decryptStream(path, key)) text += String(chunk);
      expect(text).toBe('real-private-fixture');
      expect((await readFile(path)).includes(Buffer.from('real-private-fixture'))).toBe(false);
      await expect(verifyEncrypted(path, randomBytes(32))).rejects.toThrow();
      const corrupt = await readFile(path);
      corrupt[20] ^= 1;
      await writeFile(path, corrupt);
      await expect(verifyEncrypted(path, key)).rejects.toThrow();
      await expect(
        encryptStream(Readable.from('too-long'), join(dir, 'oversize.enc'), key, 2),
      ).rejects.toThrow('size limit');
      expect(() => backupKey('invalid')).toThrow();
      expect(backupKey(key.toString('base64'))).toEqual(key);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
