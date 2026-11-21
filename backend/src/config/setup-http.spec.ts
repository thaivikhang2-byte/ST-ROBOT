import { CanActivate, Controller, ExecutionContext, Get, Injectable, UnauthorizedException, UseGuards } from '@nestjs/common';
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
}

describe('HTTP CORS preflight policy', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CorsFixtureController],
      providers: [
        CurrentSessionGuard,
        { provide: ConfigService, useValue: new ConfigService({
          app: { corsOrigin: allowedOrigin, nodeEnv: 'test' },
          logging: { level: 'error', httpSampleRate: 0 },
          storage: { provider: 'disabled' },
          video: { cloudEnabled: false },
        }) },
        { provide: MetricsService, useValue: {
          active: { inc: jest.fn(), dec: jest.fn() }, record: jest.fn(),
        } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    setupHttp(app);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}/api/v1/cors-fixture`;
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
