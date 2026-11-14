import { HttpStatus, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { storageConfig } from '../../config/configurations';
import { DomainException } from '../../shared/sdk/errors/domain.exception';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';
import type { IStorageProvider } from '../../shared/sdk/storage/interfaces/storage-provider.interface';

export function storageUnavailable() {
  return new DomainException(
    'Media storage unavailable',
    ErrorCode.SERVICE_UNAVAILABLE,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

@Injectable()
export class StorageService implements IStorageProvider, OnModuleDestroy {
  private client?: S3Client;
  private signer?: S3Client;
  readonly name: string;
  constructor(@Inject(storageConfig.KEY) readonly settings: ConfigType<typeof storageConfig>) {
    this.name = settings.provider;
    const validEndpoint = (value: string) => {
      if (!value) return settings.provider === 's3';
      try {
        const url = new URL(value);
        return (
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname === '/' &&
          (url.protocol === 'https:' || (settings.provider === 'minio' && url.protocol === 'http:'))
        );
      } catch {
        return false;
      }
    };
    if (
      settings.provider === 'disabled' ||
      !settings.bucket ||
      !settings.accessKeyId ||
      !settings.secretAccessKey ||
      !validEndpoint(settings.endpoint) ||
      !validEndpoint(settings.publicEndpoint)
    )
      return;
    const options = {
      region: settings.region,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      forcePathStyle: settings.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 3000, requestTimeout: 60000 },
    };
    this.client = new S3Client({ ...options, endpoint: settings.endpoint || undefined });
    this.signer = new S3Client({ ...options, endpoint: settings.publicEndpoint || undefined });
  }
  requireAvailable() {
    if (!this.client || !this.signer) throw storageUnavailable();
    return { client: this.client, signer: this.signer };
  }
  matches(provider: string, bucket: string) {
    this.requireAvailable();
    if (provider !== this.name || bucket !== this.settings.bucket) throw storageUnavailable();
  }
  async upload(key: string, data: Buffer, mimeType: string) {
    const { client } = this.requireAvailable();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.settings.bucket,
          Key: key,
          Body: data,
          ContentType: mimeType,
          CacheControl: 'private, no-store',
          IfNoneMatch: '*',
        }),
      );
      return { key, bucket: this.settings.bucket, provider: this.name, size: data.length };
    } catch {
      throw storageUnavailable();
    }
  }
  async delete(key: string) {
    const { client } = this.requireAvailable();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
    } catch {
      throw storageUnavailable();
    }
  }
  async deleteVideoPrefix(prefix: string) {
    // Only server-generated rendition folders are eligible; never accept an arbitrary bucket prefix.
    if (!/^video-hls\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(prefix)) throw storageUnavailable();
    const { client } = this.requireAvailable();
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: this.settings.bucket,
          Prefix: prefix + '/',
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const object of page.Contents ?? []) if (object.Key) await this.delete(object.Key);
      token = page.NextContinuationToken;
    } while (token);
  }
  async downloadToFile(key: string, filename: string, expectedSize: number) {
    const { client } = this.requireAvailable();
    const result = await client.send(
      new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }),
    );
    if (!result.Body || result.ContentLength !== expectedSize) throw storageUnavailable();
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > expectedSize) return callback(storageUnavailable());
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(result.Body as Readable, meter, createWriteStream(filename, { flags: 'wx' }), {
      signal: AbortSignal.timeout(120000),
    });
    if (bytes !== expectedSize) throw storageUnavailable();
    return hash.digest('hex');
  }
  async uploadFile(key: string, filename: string, mimeType: string) {
    const { client } = this.requireAvailable();
    const size = (await stat(filename)).size;
    const body = createReadStream(filename);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.settings.bucket,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentType: mimeType,
          CacheControl: 'private, no-store',
          IfNoneMatch: '*',
        }),
      );
    } finally {
      body.destroy();
    }
    return size;
  }
  async createUploadUrl(key: string, size: number, mimeType: string, expires: number) {
    const { signer } = this.requireAvailable();
    try {
      return await getSignedUrl(
        signer,
        new PutObjectCommand({
          Bucket: this.settings.bucket,
          Key: key,
          ContentType: mimeType,
          ContentLength: size,
          IfNoneMatch: '*',
        }),
        {
          expiresIn: expires,
          signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
        },
      );
    } catch {
      throw storageUnavailable();
    }
  }
  async getSignedUrl(key: string, expires: number, mimeType?: string, filename = 'resource') {
    const { signer } = this.requireAvailable();
    // Private CDN domains need an independently verified signer. Never rewrite a signed S3 host.
    const disposition =
      mimeType?.startsWith('image/') || mimeType?.startsWith('video/') ? 'inline' : 'attachment';
    const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
    try {
      return await getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket: this.settings.bucket,
          Key: key,
          ResponseCacheControl: 'private, no-store',
          ResponseContentType: mimeType,
          ResponseContentDisposition: `${disposition}; filename="${safeName}"`,
        }),
        { expiresIn: expires },
      );
    } catch {
      throw storageUnavailable();
    }
  }
  async getMetadata(key: string) {
    const { client } = this.requireAvailable();
    try {
      const data = await client.send(
        new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }),
      );
      return {
        key,
        size: data.ContentLength ?? 0,
        mimeType: data.ContentType ?? '',
        lastModified: data.LastModified ?? new Date(0),
        etag: data.ETag,
      };
    } catch (error) {
      if (error instanceof Error && ['NotFound', 'NoSuchKey'].includes(error.name)) {
        try {
          await client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
          return null;
        } catch {
          throw storageUnavailable();
        }
      }
      throw storageUnavailable();
    }
  }
  async exists(key: string) {
    return !!(await this.getMetadata(key));
  }
  async read(key: string, maxBytes: number) {
    const { client } = this.requireAvailable();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60000);
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }),
        { abortSignal: abort.signal },
      );
      if (!result.Body || (result.ContentLength ?? 0) > maxBytes) {
        abort.abort();
        throw storageUnavailable();
      }
      const stream = result.Body as Readable;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const value of stream) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
        size += chunk.length;
        if (size > maxBytes) {
          stream.destroy();
          throw storageUnavailable();
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, size);
    } catch {
      throw storageUnavailable();
    } finally {
      clearTimeout(timer);
    }
  }
  onModuleDestroy() {
    this.client?.destroy();
    this.signer?.destroy();
  }
}
