import { Injectable, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron } from '@nestjs/schedule';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, posix, sep } from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OperationsAccess } from '../system/operations-access';
import { operationsConfig, databaseConfig, aiVaultConfig } from '../../config/configurations';
import { AppLoggerService } from '../../shared/sdk/logger/logger.service';
import { backupKey, encryptStream, verifyEncrypted, decryptStream } from './backup-crypto';
import { queuedContext } from '../../shared/sdk/logger/request-context';
import { ServiceUnavailableException } from '@nestjs/common';
import { verifyBackup } from './restore-disposable';
export interface BackupPart {
  file: string;
  sha256: string;
  bytes: number;
  encryptedBytes: number;
  objectKey?: string;
  plainSha256: string;
}
export interface BackupManifest {
  version: 1;
  id: string;
  snapshotAt: string;
  migrations: string[];
  parts: BackupPart[];
  bucket: string | null;
  vault: boolean;
  requiredKeys: string[];
  limitations: string[];
}
@Injectable()
export class BackupService {
  constructor(
    private readonly db: PrismaService,
    private readonly storage: StorageService,
    private readonly access: OperationsAccess,
    @InjectQueue('operations-backup') private readonly queue: Queue,
    private readonly logger: AppLoggerService,
    @Inject(operationsConfig.KEY) readonly config: ConfigType<typeof operationsConfig>,
    @Inject(databaseConfig.KEY) private readonly database: ConfigType<typeof databaseConfig>,
    @Inject(aiVaultConfig.KEY) private readonly vault: ConfigType<typeof aiVaultConfig>,
  ) {}
  async list(actorId: string) {
    await this.access.check(actorId, 'backup:read');
    const rows = await this.db.backupRecord.findMany({
      select: { id: true, status: true, size: true, created_at: true, type: true },
      orderBy: { created_at: 'desc' },
      take: 30,
    });
    return rows.map((r) => ({ ...r, size: r.size.toString() }));
  }
  async enqueue(actorId?: string) {
    if (actorId) await this.access.check(actorId, 'backup:create');
    if (!this.config.backupEnabled) throw new ServiceUnavailableException('Backups are disabled');
    backupKey(this.config.backupKey);
    const job = await this.queue.add(
      'snapshot',
      { ...queuedContext() },
      {
        jobId: `snapshot-${Math.floor(Date.now() / 300000)}`,
        attempts: 1,
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    );
    if (actorId)
      await this.db.auditLog.create({
        data: { user_id: actorId, action: 'backup.requested', resource: 'backup' },
      });
    return { jobId: String(job.id), status: 'queued' };
  }
  @Cron('*/5 * * * *', { waitForCompletion: true })
  async scheduled() {
    if (!this.config.backupEnabled) return;
    try {
      const last = await this.db.backupRecord.findFirst({
        where: { status: 'completed' },
        orderBy: { created_at: 'desc' },
      });
      if (
        !last ||
        last.created_at.getTime() < Date.now() - this.config.backupIntervalHours * 3600000
      )
        await this.enqueue();
    } catch {
      this.logger.event('error', 'backup.schedule_unavailable');
    }
  }
  async create() {
    if (!this.config.backupEnabled) throw new Error('Backups are disabled');
    const key = backupKey(this.config.backupKey),
      id = randomUUID(),
      directory = join(resolve(this.config.backupDirectory), id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const record = await this.db.backupRecord.create({
      data: {
        id,
        filename: id,
        size: 0,
        provider: 'encrypted-local',
        storage_path: directory,
        status: 'running',
        type: 'full',
      },
    });
    let total = 0;
    const part = async (
      source: Readable,
      file: string,
      objectKey?: string,
    ): Promise<BackupPart> => {
      const result = await encryptStream(
        source,
        join(directory, file),
        key,
        this.config.backupMaxBytes - total,
      );
      total += result.bytes;
      await verifyEncrypted(join(directory, file), key, result.sha256);
      return { file, ...result, ...(objectKey ? { objectKey } : {}) };
    };
    try {
      await this.db.$transaction(
        async (tx) => {
          const lock = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(120012) AS locked`;
          if (!lock[0]?.locked) throw new Error('Another snapshot is running');
          const snapshots = await tx.$queryRaw<
            { snapshot: string }[]
          >`SELECT pg_export_snapshot() AS snapshot`;
          const manifest: BackupManifest = {
            version: 1,
            id,
            snapshotAt: new Date().toISOString(),
            migrations: (
              await tx.$queryRaw<
                { migration_name: string }[]
              >`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`
            ).map((x) => x.migration_name),
            parts: [],
            bucket: this.storage.name === 'disabled' ? null : this.storage.settings.bucket,
            vault: false,
            requiredKeys: [],
            limitations: [
              'Object keys are copied and authenticated during the DB snapshot. Concurrent deletion makes the backup fail; uploads not referenced by the snapshot may be extra.',
              'External video providers, external labs and server-side encryption keys require separate provider recovery.',
              'Release source/configuration placeholders and secret keys must be preserved separately.',
            ],
          };
          const sources = await tx.storageObject.findMany({
            where: { deleted_at: null, status: 'ready' },
            select: { object_key: true, bucket: true, provider: true, checksum: true },
          });
          const hls = await tx.video.findMany({
            where: { deleted_at: null, status: 'ready', provider: 'self-hosted' },
            select: { hls_prefix: true },
          });
          if (
            sources.some(
              (x) => x.provider !== this.storage.name || x.bucket !== this.storage.settings.bucket,
            )
          )
            throw new Error('Referenced storage provider is not included in this snapshot');
          manifest.requiredKeys.push(
            ...sources.map((x) => x.object_key),
            ...hls.filter((x) => x.hls_prefix).map((x) => `${x.hls_prefix}/master.m3u8`),
          );
          if (manifest.requiredKeys.length && this.storage.name === 'disabled')
            throw new Error('Required storage is disabled');
          const url = new URL(this.database.url!);
          if (!['postgresql:', 'postgres:'].includes(url.protocol))
            throw new Error('Unsupported database configuration');
          const child = spawn(
            this.config.pgDump,
            ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshots[0].snapshot}`],
            {
              env: {
                ...this.config.childEnvironment,
                PGHOST: url.hostname,
                PGPORT: url.port || '5432',
                PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
                PGUSER: decodeURIComponent(url.username),
                PGPASSWORD: decodeURIComponent(url.password),
                PGCONNECT_TIMEOUT: '10',
                PGSSLMODE: url.searchParams.get('sslmode') || 'prefer',
              },
              stdio: ['ignore', 'pipe', 'ignore'],
              timeout: this.config.backupTimeoutSeconds * 1000,
            },
          );
          // Observe exit immediately, including spawn errors; never log process arguments or stderr.
          const exit = new Promise<void>((ok, fail) => {
            child.once('error', () => fail(new Error('Database backup client unavailable')));
            child.once('close', (code) =>
              code === 0 ? ok() : fail(new Error('Database backup command failed')),
            );
          });
          exit.catch(() => {});
          try {
            manifest.parts.push(await part(child.stdout, 'database.enc'));
            await exit;
          } catch (e) {
            child.kill();
            throw e;
          }
          if (this.storage.name !== 'disabled') {
            const client = this.storage.requireAvailable().client;
            let token: string | undefined;
            const copied = new Set<string>();
            do {
              const page = await client.send(
                new ListObjectsV2Command({
                  Bucket: this.storage.settings.bucket,
                  ContinuationToken: token,
                }),
                { abortSignal: AbortSignal.timeout(this.config.backupTimeoutSeconds * 1000) },
              );
              for (const object of page.Contents ?? []) {
                if (!object.Key) continue;
                const result = await client.send(
                  new GetObjectCommand({ Bucket: this.storage.settings.bucket, Key: object.Key }),
                  { abortSignal: AbortSignal.timeout(this.config.backupTimeoutSeconds * 1000) },
                );
                const copiedPart = await part(
                  result.Body as Readable,
                  `object-${manifest.parts.length}.enc`,
                  object.Key,
                );
                const required = sources.find((x) => x.object_key === object.Key);
                if (required && copiedPart.plainSha256 !== required.checksum)
                  throw new Error('Referenced object checksum mismatch');
                manifest.parts.push(copiedPart);
                copied.add(object.Key);
              }
              token = page.IsTruncated ? page.NextContinuationToken : undefined;
            } while (token);
            if (manifest.requiredKeys.some((k) => !copied.has(k)))
              throw new Error('Required media is missing; backup is incomplete');
            for (const playlist of manifest.parts.filter(
              (p) => p.objectKey?.startsWith('video-hls/') && p.objectKey.endsWith('.m3u8'),
            )) {
              if (playlist.bytes > 1048576) throw new Error('HLS playlist exceeds supported size');
              let text = '';
              for await (const chunk of await decryptStream(join(directory, playlist.file), key))
                text += String(chunk);
              for (const line of text
                .split(/\r?\n/)
                .map((x) => x.trim())
                .filter((x) => x && !x.startsWith('#'))) {
                if (
                  /^[a-z]+:|^\/|[?#]/i.test(line) ||
                  !copied.has(posix.join(posix.dirname(playlist.objectKey!), line))
                )
                  throw new Error('HLS references missing or external bytes');
              }
            }
          }
          try {
            const bytes = await readFile(this.vault.path);
            manifest.parts.push(await part(Readable.from(bytes), 'vault.enc'));
            manifest.vault = true;
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          }
          await part(Readable.from(JSON.stringify(manifest)), 'manifest.enc');
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: this.config.backupTimeoutSeconds * 1000,
          maxWait: 10000,
        },
      );
      await this.db.backupRecord.update({
        where: { id },
        data: {
          status: 'completed',
          size: BigInt(total),
          metadata: { verified: true, format: 'STRB12-AES-256-GCM', keyRequired: true },
        },
      });
      await this.db.auditLog.create({
        data: { action: 'backup.completed', resource: 'backup', resource_id: id },
      });
      this.logger.event('info', 'backup.completed', { backupId: id, bytes: total });
      try {
        await this.retention(key);
      } catch {
        // A pruning failure must not invalidate the successfully authenticated replacement.
        this.logger.event('warn', 'backup.retention_unavailable');
      }
      return { id, status: 'completed' };
    } catch {
      await this.db.backupRecord.update({
        where: { id: record.id },
        data: { status: 'failed', metadata: { category: 'SNAPSHOT_UNAVAILABLE' } },
      });
      this.logger.event('error', 'backup.failed', { backupId: id });
      throw new Error('Encrypted snapshot failed; inspect dependency configuration');
    }
  }
  async retention(key: Buffer) {
    const good = await this.db.backupRecord.findMany({
      where: { provider: 'encrypted-local', status: 'completed' },
      orderBy: { created_at: 'desc' },
    });
    // Keep at least two verified full backups. Never prune on a failed replacement.
    if (good.length < 3) return;
    for (const row of good.slice(2)) {
      if (row.created_at.getTime() > Date.now() - this.config.backupRetentionDays * 86400000)
        continue;
      if (!/^[a-f0-9-]{36}$/.test(row.id)) continue;
      const target = resolve(this.config.backupDirectory, row.id);
      if (
        target !== resolve(row.storage_path) ||
        !target.startsWith(resolve(this.config.backupDirectory) + sep)
      )
        continue;
      for (const keeper of good.slice(0, 2))
        await verifyBackup(join(resolve(this.config.backupDirectory), keeper.id), key);
      await rm(target, { recursive: true });
      await this.db.backupRecord.update({ where: { id: row.id }, data: { status: 'expired' } });
    }
  }
}
