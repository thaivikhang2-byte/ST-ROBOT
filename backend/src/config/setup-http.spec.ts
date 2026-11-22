import { CanActivate, Controller, ExecutionContext, Get, Injectable, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { MetricsService } from '../metrics/metrics.service';
import { setupHttp } from './setup-http';

const allowedOrigin = 'https://learning.example.test';
let sessionActive = true;
const authenticate = jest.fn();

@Injectable()
class CurrentSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    authenticate();
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    if (request.headers.authorization !== 'Bearer fixture-session' || !sessionActive)
      throw new UnauthorizedException('Session is no longer active');
    return true;
  }
}

@Controller('v1/cors-fixture')
@UseGuards(CurrentSessionGuard)
class CorsFixtureController {
  @Get()
  get() { return { ok: true }; }

  @Post('slow/:recordId')
  async slow() {
    await new Promise(resolve => setTimeout(resolve, 1050));
    return { ok: true };
  }
}

async function createFixture(level: 'error' | 'info') {
  const module = await Test.createTestingModule({
    controllers: [CorsFixtureController],
    providers: [
      CurrentSessionGuard,
      { provide: ConfigService, useValue: new ConfigService({
        app: { corsOrigin: allowedOrigin, nodeEnv: 'test' },
        logging: { level, httpSampleRate: 0 },
        storage: { provider: 'disabled' },
        video: { cloudEnabled: false },
      }) },
      { provide: MetricsService, useValue: {
        active: { inc: jest.fn(), dec: jest.fn() }, record: jest.fn(),
      } },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  setupHttp(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${address.port}/api/v1/cors-fixture` };
}

describe('HTTP CORS preflight policy', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await createFixture('error'));
  });

  beforeEach(() => { sessionActive = true; authenticate.mockClear(); });
  afterAll(async () => { if (app) await app.close(); });

  const preflight = (origin = allowedOrigin) => fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });

  it('lets the browser reuse an allowed bearer preflight while retaining its origin and credential restrictions', async () => {
    const response = await preflight();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin);
    expect(response.headers.get('access-control-max-age')).toBe('600');
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('vary')).toContain('Origin');
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('does not authorize a disallowed origin through the preflight policy', async () => {
    const response = await preflight('https://untrusted.example.test');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('still checks each API request and immediately rejects a revoked session after a successful preflight', async () => {
    expect((await preflight()).status).toBe(204);
    const headers = { Origin: allowedOrigin, Authorization: 'Bearer fixture-session' };
    const initial = await fetch(url, { headers });
    expect(initial.status).toBe(200);
    expect(initial.headers.get('access-control-max-age')).toBeNull();
    expect(await initial.json()).toEqual({ ok: true });

    sessionActive = false;
    // A cached browser preflight skips OPTIONS, never this authenticated request.
    const revoked = await fetch(url, { headers });
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get('access-control-max-age')).toBeNull();
    await revoked.arrayBuffer();
    expect(authenticate).toHaveBeenCalledTimes(2);
  });
});

describe('Private slow HTTP diagnostics', () => {
  let app: INestApplication;
  let url: string;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeAll(async () => { ({ app, url } = await createFixture('info')); });
  beforeEach(() => {
    sessionActive = true;
    authenticate.mockClear();
    // A successful request cannot be selected by the ordinary sample in this fixture.
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => { jest.restoreAllMocks(); });
  afterAll(async () => { if (app) await app.close(); });

  it('records an unsampled slow success with route template and trace correlation but no request content', async () => {
    const requestId = '11111111-2222-4333-8444-555555555555';
    const traceId = '1234567890abcdef1234567890abcdef';
    const privatePath = 'private-record-value';
    const privateBody = { email: 'private-learner@example.test', password: 'private-password-value', userId: 'private-user-value', sql: 'private-query-value' };
    const response = await fetch(`${url}/slow/${privatePath}?email=${encodeURIComponent(privateBody.email)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Authorization: 'Bearer fixture-session',
        'X-Request-ID': requestId, traceparent: `00-${traceId}-1234567890abcdef-01`,
        'X-Private-Fixture': 'private-header-value',
      },
      body: JSON.stringify(privateBody),
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-request-id')).toBe(requestId);
    expect(await response.json()).toEqual({ ok: true });
    const records = log.mock.calls.map(([entry]) => JSON.parse(String(entry)));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'info', message: 'http.completed', traceId,
      metadata: { method: 'POST', route: '/api/v1/cors-fixture/slow/:recordId', status: 201, requestId },
    });
    expect(records[0].metadata.durationMs).toBeGreaterThanOrEqual(1000);
    expect(Object.keys(records[0].metadata).sort()).toEqual([
      'durationMs', 'method', 'operation', 'requestId', 'route', 'service', 'status',
    ]);
    const serialized = JSON.stringify(records);
    for (const value of [privatePath, ...Object.values(privateBody), 'fixture-session', 'private-header-value'])
      expect(serialized).not.toContain(value);
  });

  it('keeps a fast successful response unsampled when the rate is zero', async () => {
    const response = await fetch(url, { headers: { Authorization: 'Bearer fixture-session' } });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('retains error diagnostics even when the ordinary sample is disabled', async () => {
    sessionActive = false;
    const response = await fetch(url, { headers: { Authorization: 'Bearer fixture-session' } });
    expect(response.status).toBe(401);
    await response.arrayBuffer();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({
      level: 'warn', message: 'http.completed',
      metadata: { method: 'GET', route: '/api/v1/cors-fixture', status: 401 },
    });
  });
});
