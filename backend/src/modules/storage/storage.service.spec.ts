import { storageConfig } from '../../config/configurations';
import { ConfigType } from '@nestjs/config';
import { StorageService } from './storage.service';
import { envValidationSchema } from '../../config/env.validation';
const settings = (): ConfigType<typeof storageConfig> => ({
  provider: 'minio',
  endpoint: 'http://127.0.0.1:19000',
  publicEndpoint: 'http://127.0.0.1:19000',
  region: 'us-east-1',
  bucket: 'test',
  accessKeyId: 'test',
  secretAccessKey: 'test-secret',
  forcePathStyle: true,
  maxBytes: 1024,
  uploadTtl: 900,
  downloadTtl: 300,
  cdnBaseUrl: 'https://unverified-cdn.example',
});
describe('Storage configuration and grants', () => {
  it('validates upload limits, TTL bounds and provider names at the environment boundary', () => {
    const env = {
      DATABASE_URL: 'postgresql://test@localhost/test',
      JWT_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
    };
    expect(
      envValidationSchema.validate({ ...env, STORAGE_PROVIDER: 'disabled' }).error,
    ).toBeUndefined();
    for (const change of [
      { MEDIA_DOWNLOAD_URL_TTL_SECONDS: 301 },
      { MEDIA_UPLOAD_URL_TTL_SECONDS: 901 },
      { MEDIA_MAX_UPLOAD_BYTES: 104857601 },
      { STORAGE_PROVIDER: 'fake' },
      { S3_ENDPOINT: 'file:///secret' },
    ]) {
      expect(envValidationSchema.validate({ ...env, ...change }).error).toBeDefined();
    }
  });
  it('fails closed with missing credentials without throwing during module creation', async () => {
    const service = new StorageService({ ...settings(), secretAccessKey: '' });
    expect(() => service.requireAvailable()).toThrow('Media storage unavailable');
    await expect(service.getSignedUrl('key', 30)).rejects.toThrow('Media storage unavailable');
  });
  it('rejects non-TLS cloud endpoints and embedded credentials', () => {
    const cloud = new StorageService({ ...settings(), provider: 'r2' });
    expect(() => cloud.requireAvailable()).toThrow();
    const embedded = new StorageService({
      ...settings(),
      endpoint: 'https://user:secret@example.com',
    });
    expect(() => embedded.requireAvailable()).toThrow();
  });
  it('signs the exact upload headers and never rewrites delivery to an unverified CDN', async () => {
    const service = new StorageService(settings());
    try {
      const upload = new URL(await service.createUploadUrl('incoming/test', 123, 'image/png', 900));
      expect(upload.searchParams.get('X-Amz-SignedHeaders')).toBe(
        'content-length;content-type;host;if-none-match',
      );
      const download = new URL(
        await service.getSignedUrl('media/test', 300, 'application/pdf', 'a\r\n.pdf'),
      );
      expect(download.host).toBe('127.0.0.1:19000');
      expect(download.searchParams.get('response-content-disposition')).toContain(
        'attachment; filename="a__.pdf"',
      );
      expect(download.searchParams.get('response-cache-control')).toBe('private, no-store');
    } finally {
      service.onModuleDestroy();
    }
  });
});
