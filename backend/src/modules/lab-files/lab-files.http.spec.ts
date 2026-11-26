import { Body, CanActivate, Controller, ExecutionContext, INestApplication, Injectable, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { setupHttp } from '../../config/setup-http';
import { MetricsService } from '../../metrics/metrics.service';
import { TransformInterceptor } from '../../shared/sdk';
import { LabFilesController } from './lab-files.controller';
import { LabFilesService } from './lab-files.service';

const fileId = '8cf89009-66f9-4f21-8570-e6a3107ca5c4';
const ownerId = 'fda2f5c1-b0c0-4ddd-80d4-311d1a5aa5fb';
let sessionActive = true;
@Injectable()
class FixtureSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (!sessionActive || request.headers.authorization !== 'Bearer fixture-session') throw new UnauthorizedException();
    request.user = { id: ownerId };
    return true;
  }
}

@Controller('v1/ordinary-lab-fixture')
class OrdinaryBodyController {
  @Post()
  post(@Body() body: unknown) { return body; }
}

describe('Private lab file HTTP body and identity boundaries', () => {
  let app: INestApplication;
  let base: string;
  const files = {
    list: jest.fn().mockResolvedValue({ files: [] }),
    begin: jest.fn().mockResolvedValue({ id: fileId }),
    putChunk: jest.fn().mockResolvedValue({ id: fileId, index: 0 }),
    getChunk: jest.fn().mockResolvedValue({ index: 0, dataBase64: 'AA==' }),
    complete: jest.fn().mockResolvedValue({ id: fileId }),
    remove: jest.fn().mockResolvedValue({ success: true }),
  };
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-session' };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LabFilesController, OrdinaryBodyController],
      providers: [
        { provide: LabFilesService, useValue: files },
        { provide: ConfigService, useValue: new ConfigService({ app: { corsOrigin: 'https://learning.example.test', nodeEnv: 'test' }, logging: { level: 'error', httpSampleRate: 0 }, storage: { provider: 'disabled' }, video: { cloudEnabled: false } }) },
        { provide: MetricsService, useValue: { active: { inc: jest.fn(), dec: jest.fn() }, record: jest.fn() } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    setupHttp(app);
    app.useGlobalGuards(new FixtureSessionGuard());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });
  beforeEach(() => { sessionActive = true; Object.values(files).forEach(mock => mock.mockClear()); });
  afterAll(async () => { await app?.close(); });

  it('accepts a full 1 MiB chunk only on its dedicated bounded JSON route', async () => {
    const dataBase64 = Buffer.alloc(1024 * 1024, 127).toString('base64');
    const response = await fetch(`${base}/lab-files/${fileId}/chunks/0`, { method: 'PUT', headers, body: JSON.stringify({ dataBase64 }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(files.putChunk).toHaveBeenCalledWith({ id: ownerId }, fileId, 0, dataBase64);
    expect((await response.json()).data).toEqual({ id: fileId, index: 0 });
    const ordinary = await fetch(`${base}/ordinary-lab-fixture`, { method: 'POST', headers, body: JSON.stringify({ text: 'x'.repeat(160 * 1024) }) });
    expect(ordinary.status).toBe(413);
    const oversizedBegin = await fetch(`${base}/lab-files/uploads`, { method: 'POST', headers, body: JSON.stringify({ text: 'x'.repeat(160 * 1024) }) });
    expect(oversizedBegin.status).toBe(413);
    expect(files.begin).not.toHaveBeenCalled();
  });

  it('rejects an over-2-MiB chunk body before reaching the storage service', async () => {
    const response = await fetch(`${base}/lab-files/${fileId}/chunks/0`, { method: 'PUT', headers, body: JSON.stringify({ dataBase64: 'a'.repeat(2 * 1024 * 1024) }) });
    expect(response.status).toBe(413);
    expect(files.putChunk).not.toHaveBeenCalled();
  });

  it('rejects owner injection and malformed route identifiers without calling storage', async () => {
    const ownerInjection = await fetch(`${base}/lab-files/uploads`, { method: 'POST', headers, body: JSON.stringify({
      courseId: 'arduino', lessonId: 'led', platformKey: 'circuit', name: 'photo.jpg', sizeBytes: 20,
      clientUploadId: fileId, ownerId: 'another-owner',
    }) });
    expect(ownerInjection.status).toBe(400);
    expect(files.begin).not.toHaveBeenCalled();
    const unexpectedQuery = await fetch(`${base}/lab-files?courseId=arduino&lessonId=led&platformKey=circuit&ownerId=other`, { headers });
    expect(unexpectedQuery.status).toBe(400);
    expect(files.list).not.toHaveBeenCalled();
    const invalidId = await fetch(`${base}/lab-files/not-a-uuid/chunks/0`, { headers });
    expect(invalidId.status).toBe(400);
    expect(files.getChunk).not.toHaveBeenCalled();
  });

  it('passes only the authenticated session owner and rechecks revoked sessions', async () => {
    const first = await fetch(`${base}/lab-files/${fileId}/chunks/0`, { headers });
    expect(first.status).toBe(200);
    expect(files.getChunk).toHaveBeenCalledWith({ id: ownerId }, fileId, 0);
    sessionActive = false;
    const after = await fetch(`${base}/lab-files/${fileId}/chunks/0`, { headers });
    expect(after.status).toBe(401);
    expect(files.getChunk).toHaveBeenCalledTimes(1);
    const anonymous = await fetch(`${base}/lab-files/${fileId}/chunks/0`);
    expect(anonymous.status).toBe(401);
    expect(files.getChunk).toHaveBeenCalledTimes(1);
  });
});
