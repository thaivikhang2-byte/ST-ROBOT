import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigType } from '@nestjs/config';
import { videoConfig } from '../../config/configurations';
import { CloudflareStreamProvider } from './cloudflare-stream.provider';
import { SelfHostedHlsProvider } from './self-hosted-hls.provider';
import { ladder, safeHlsFile } from './video-provider';
import { StorageService } from '../storage/storage.service';

const settings = {
  cloudEnabled: true,
  cloudAccount: 'a'.repeat(32),
  cloudToken: 'test-only',
  cloudCustomer: 'qa',
  webhookSecret: 'test-webhook-secret',
  timeout: 30,
} as ConfigType<typeof videoConfig>;
describe('Phase 10 provider protocols and manifest invariants', () => {
  it('never upscales and generates distinct adaptive variants only when dimensions allow', () => {
    expect(ladder(1280, 720).map((r) => r.height)).toEqual([360, 720]);
    expect(ladder(640, 240).map((r) => r.height)).toEqual([240]);
    expect(ladder(1920, 1080)).toHaveLength(3);
  });
  it('rejects traversal, URLs, queries and undeclared extensions in manifests', () => {
    for (const n of [
      '../key',
      'https://evil/file.ts',
      '360p.m3u8?token=x',
      'segment.exe',
      'foo.ts',
    ])
      expect(safeHlsFile(n)).toBe(false);
    expect(safeHlsFile('360p-00001.ts')).toBe(true);
  });
  it('creates a private direct upload using documented REST fields', async () => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            result: { uid: 'b'.repeat(32), uploadURL: 'https://upload.videodelivery.net/one-time' },
          }),
        ),
      );
    const p = new CloudflareStreamProvider(settings, transport);
    expect((await p.createUpload(600)).uid).toBe('b'.repeat(32));
    const [url, init] = transport.mock.calls[0];
    expect(url).toContain('/stream/direct_upload');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      maxDurationSeconds: 600,
      requireSignedURLs: true,
    });
  });
  it('fails closed when disabled, on provider errors or an untrusted upload origin', async () => {
    const transport = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    await expect(
      new CloudflareStreamProvider({ ...settings, cloudEnabled: false }, transport).createUpload(
        60,
      ),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(
      new CloudflareStreamProvider(settings, transport).status('b'.repeat(32)),
    ).rejects.toThrow();
    transport.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: { uid: 'b'.repeat(32), uploadURL: 'https://evil.test/upload' },
        }),
      ),
    );
    await expect(
      new CloudflareStreamProvider(settings, transport).createUpload(60),
    ).rejects.toThrow();
  });
  it('requires both ready state and requireSignedURLs for managed playback readiness', async () => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              readyToStream: true,
              requireSignedURLs: false,
              status: { state: 'ready' },
              duration: 20,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              readyToStream: true,
              requireSignedURLs: true,
              status: { state: 'ready' },
              duration: 20,
            },
          }),
        ),
      );
    const p = new CloudflareStreamProvider(settings, transport);
    expect((await p.status('b'.repeat(32))).ready).toBe(false);
    expect((await p.status('b'.repeat(32))).ready).toBe(true);
  });
  it('requests bounded signed HLS access without download capability', async () => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, result: { token: 'signed.jwt.token' } })),
      );
    const p = new CloudflareStreamProvider(settings, transport);
    expect(await p.playback('b'.repeat(32), 123456)).toBe(
      'https://customer-qa.cloudflarestream.com/signed.jwt.token/manifest/video.m3u8',
    );
    const tokenRequest = transport.mock.calls[0];
    expect(JSON.parse(tokenRequest[1]?.body as string)).toEqual({
      exp: 123456,
      downloadable: false,
    });
  });
  it('deletes only a validated provider UID using the documented DELETE route', async () => {
    const transport = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('{}'));
    const p = new CloudflareStreamProvider(settings, transport);
    await p.deleteVideo('b'.repeat(32));
    expect(transport.mock.calls[0][1]?.method).toBe('DELETE');
    await expect(p.deleteVideo('../other')).rejects.toThrow();
  });
  it('checks raw bytes, HMAC, freshness and canonical replay identity', () => {
    const p = new CloudflareStreamProvider(settings, fetch),
      time = String(Math.floor(Date.now() / 1000)),
      raw = Buffer.from('{"uid":"video"}\n');
    const sig = createHmac('sha256', settings.webhookSecret)
      .update(time + '.')
      .update(raw)
      .digest('hex');
    const digest = p.verifyWebhook(raw, `time=${time},sig1=${sig}`);
    expect(p.verifyWebhook(raw, `sig1=${sig},time=${time}`)).toBe(digest);
    expect(() => p.verifyWebhook(Buffer.from('{}'), `time=${time},sig1=${sig}`)).toThrow();
    expect(() => p.verifyWebhook(raw, `time=1,sig1=${sig}`)).toThrow();
    expect(() => p.verifyWebhook(raw, `time=${time},sig1=${'0'.repeat(64)}`)).toThrow();
  });
  it('detects a missing segment rather than declaring an incomplete package playable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'st-video-manifest-test-'));
    const provider = new SelfHostedHlsProvider(settings, {} as StorageService);
    try {
      await writeFile(join(dir, 'master.m3u8'), '#EXTM3U\n360p.m3u8\n');
      await writeFile(
        join(dir, '360p.m3u8'),
        '#EXTM3U\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXTINF:4,\n360p-00000.ts\n#EXT-X-ENDLIST\n',
      );
      await expect(provider.validateOutput(dir, ladder(640, 360))).rejects.toThrow(
        'MISSING_SEGMENT',
      );
      await writeFile(join(dir, '360p-00000.ts'), Buffer.alloc(188));
      await expect(provider.validateOutput(dir, ladder(640, 360))).resolves.toHaveLength(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
