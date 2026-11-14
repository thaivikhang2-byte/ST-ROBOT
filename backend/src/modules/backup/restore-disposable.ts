import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { PrismaClient } from '../../database/client';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { backupKey, decryptStream, verifyEncrypted } from './backup-crypto';
import type { BackupManifest } from './backup.service';
export async function readManifest(directory: string, key: Buffer) {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of await decryptStream(join(directory, 'manifest.enc'), key)) {
    bytes += (chunk as Buffer).length;
    if (bytes > 33554432) throw new Error('Manifest exceeds limit');
    chunks.push(chunk as Buffer);
  }
  const manifest = JSON.parse(Buffer.concat(chunks).toString()) as BackupManifest;
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.parts) ||
    !manifest.parts.some((x) => x.file === 'database.enc') ||
    manifest.parts.length > 100000
  )
    throw new Error('Invalid backup manifest');
  const names = new Set<string>();
  for (const p of manifest.parts) {
    if (
      !/^(database|vault|object-[0-9]+)\.enc$/.test(p.file) ||
      names.has(p.file) ||
      !Number.isSafeInteger(p.bytes) ||
      p.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(p.sha256)
    )
      throw new Error('Unsafe manifest entry');
    names.add(p.file);
  }
  return manifest;
}
export async function verifyBackup(directory: string, key: Buffer) {
  const manifest = await readManifest(directory, key);
  for (const part of manifest.parts)
    if ((await verifyEncrypted(join(directory, part.file), key, part.sha256)) !== part.bytes)
      throw new Error('Invalid backup part size');
  return manifest;
}
/** Intentionally restricted operator entry point. No route can invoke restore. */
export async function restoreDisposable(options: {
  directory: string;
  key: string;
  databaseUrl: string;
  storage: S3Client;
  bucket: string;
  pgRestore?: string;
  timeoutMs?: number;
}) {
  const url = new URL(options.databaseUrl),
    dbName = decodeURIComponent(url.pathname.slice(1));
  if (
    !['127.0.0.1', 'localhost', 'host.docker.internal'].includes(url.hostname) ||
    url.port !== '15432' ||
    !/^st_robot_phase12_restore_[a-f0-9]{12}$/.test(dbName) ||
    !/^st-robot-phase12-restore-[a-f0-9]{12}$/.test(options.bucket)
  )
    throw new Error('Restore requires an explicitly disposable local Phase12 target');
  const key = backupKey(options.key),
    manifest = await verifyBackup(options.directory, key);
  const db = new PrismaClient({ datasourceUrl: options.databaseUrl });
  try {
    const tables = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`;
    if (Number(tables[0].count) !== 0) throw new Error('Restore target is not empty');
    let exists = true;
    try {
      await options.storage.send(new HeadBucketCommand({ Bucket: options.bucket }));
    } catch (e) {
      if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
        exists = false;
      else throw e;
    }
    if (exists) throw new Error('Restore bucket already exists');
    await options.storage.send(new CreateBucketCommand({ Bucket: options.bucket }));
    const child = spawn(
      options.pgRestore || 'pg_restore',
      ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', dbName],
      {
        env: {
          PGHOST: url.hostname,
          PGPORT: url.port,
          PGUSER: decodeURIComponent(url.username),
          PGPASSWORD: decodeURIComponent(url.password),
          PGCONNECT_TIMEOUT: '10',
        },
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: options.timeoutMs ?? 600000,
      },
    );
    const exit = new Promise<void>((ok, fail) => {
      child.once('error', () => fail(new Error('Restore client unavailable')));
      child.once('close', (code) =>
        code === 0 ? ok() : fail(new Error('Database restore failed')),
      );
    });
    exit.catch(() => {});
    try {
      await pipeline(
        await decryptStream(join(options.directory, 'database.enc'), key),
        child.stdin,
      );
      await exit;
    } catch (e) {
      child.kill();
      throw e;
    }
    for (const part of manifest.parts.filter((p) => p.objectKey)) {
      const data = await decryptStream(join(options.directory, part.file), key);
      await options.storage.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: part.objectKey,
          Body: data,
          ContentLength: part.bytes,
        }),
      );
      const result = await options.storage.send(
        new GetObjectCommand({ Bucket: options.bucket, Key: part.objectKey }),
      );
      const hash = createHash('sha256');
      for await (const chunk of result.Body as Readable) hash.update(chunk as Buffer);
      const sourceHash = createHash('sha256');
      for await (const chunk of await decryptStream(join(options.directory, part.file), key))
        sourceHash.update(chunk as Buffer);
      if (hash.digest('hex') !== sourceHash.digest('hex'))
        throw new Error('Restored object differs');
    }
    if (manifest.bucket)
      await db.storageObject.updateMany({
        where: { bucket: manifest.bucket },
        data: { bucket: options.bucket },
      });
    let vaultRestoredPath: string | null = null;
    const vault = manifest.parts.find((p) => p.file === 'vault.enc');
    if (vault) {
      const target = join(tmpdir(), options.bucket);
      await mkdir(target, { mode: 0o700 });
      const chunks: Buffer[] = [];
      if (vault.bytes > 33554432) throw new Error('Vault archive exceeds limit');
      for await (const chunk of await decryptStream(join(options.directory, vault.file), key))
        chunks.push(chunk as Buffer);
      vaultRestoredPath = join(target, 'ai-providers.enc.json');
      await writeFile(vaultRestoredPath, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
    }
    const users = await db.user.count(),
      courses = await db.course.count(),
      objects = manifest.parts.filter((p) => p.objectKey).length;
    return {
      verified: true,
      users,
      courses,
      objects,
      migrations: manifest.migrations.length,
      vaultIncluded: manifest.vault,
      vaultRestoredPath,
      vaultRestore:
        'Encrypted vault restored to an exclusive private disposable directory. Original independent vault master key still required.',
    };
  } finally {
    await db.$disconnect();
  }
}
