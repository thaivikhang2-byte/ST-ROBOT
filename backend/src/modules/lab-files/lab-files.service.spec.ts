import { BadRequestException, ConflictException, ForbiddenException, GoneException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { LearnerLabFile } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { RequestUser } from '../../shared/sdk';
import { LearningAccessService } from '../progress/learning-access.service';
import { BeginLabFileUploadDto } from './lab-files.dto';
import { LAB_FILE_LIMITS } from './lab-files.policy';
import { LabFilesService } from './lab-files.service';

const alice = { id: 'alice', sessionId: 'alice-session' } as RequestUser;
const bob = { id: 'bob', sessionId: 'bob-session' } as RequestUser;
const scope = { courseId: 'arduino', lessonId: 'led', platformKey: 'local' };
const dto = (changes: Partial<BeginLabFileUploadDto> = {}): BeginLabFileUploadDto => ({
  ...scope, name: 'ảnh.jpg', sizeBytes: 4, clientUploadId: randomUUID(), ...changes,
});
type Chunk = { file_id: string; chunk_index: number; size_bytes: number; data: Buffer };

/** Transactional data fixture models ownership filters and cascading deletion;
 * PostgreSQL concurrency/row-lock behavior belongs to the integration journey. */
function fixture() {
  const files = new Map<string, LearnerLabFile>();
  const chunks = new Map<string, Chunk>();
  const events: string[] = [];
  const matches = (row: Record<string, any>, where: Record<string, any> = {}) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'lte' in value) return row[key] != null && row[key] <= value.lte;
    return row[key] === value;
  });
  const drop = (id: string) => {
    files.delete(id);
    for (const [key, chunk] of chunks) if (chunk.file_id === id) chunks.delete(key);
  };
  const row = (changes: Partial<LearnerLabFile> = {}): LearnerLabFile => ({
    id: randomUUID(), user_id: alice.id, course_slug: scope.courseId, lesson_slug: scope.lessonId,
    platform_key: scope.platformKey, name: 'stored.bin', size_bytes: 4, chunk_count: 1, status: 'uploading',
    client_upload_id: randomUUID(), upload_expires_at: new Date(Date.now() + 60000),
    created_at: new Date(), updated_at: new Date(), ...changes,
  });
  const add = (changes: Partial<LearnerLabFile> = {}) => { const file = row(changes); files.set(file.id, file); return file; };
  const table = {
    deleteMany: jest.fn(async ({ where }) => {
      events.push('cleanup'); const selected = [...files.values()].filter(file => matches(file, where));
      selected.forEach(file => drop(file.id)); return { count: selected.length };
    }),
    findUnique: jest.fn(async ({ where }) => [...files.values()].find(file =>
      where.id ? file.id === where.id : matches(file, where.user_id_client_upload_id)) ?? null),
    findFirst: jest.fn(async ({ where }) => [...files.values()].find(file => matches(file, where)) ?? null),
    findMany: jest.fn(async ({ where, take }) => [...files.values()].filter(file => matches(file, where))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || a.id.localeCompare(b.id)).slice(0, take)),
    groupBy: jest.fn(async ({ where }) => {
      events.push('usage'); const grouped = new Map<string, { status: string; _sum: { size_bytes: number }; _count: { _all: number } }>();
      for (const file of files.values()) if (matches(file, where)) {
        const group = grouped.get(file.status) ?? { status: file.status, _sum: { size_bytes: 0 }, _count: { _all: 0 } };
        group._sum.size_bytes += file.size_bytes; group._count._all++; grouped.set(file.status, group);
      }
      return [...grouped.values()];
    }),
    count: jest.fn(async ({ where }) => [...files.values()].filter(file => matches(file, where)).length),
    create: jest.fn(async ({ data }) => { events.push('create'); return add(data); }),
    update: jest.fn(async ({ where, data }) => {
      events.push('update'); const previous = files.get(where.id); if (!previous) throw new Error('Missing fixture file');
      const changed = { ...previous, ...data }; files.set(changed.id, changed); return changed;
    }),
    delete: jest.fn(async ({ where }) => { events.push('delete'); const previous = files.get(where.id); drop(where.id); return previous; }),
  };
  const chunkTable = {
    findUnique: jest.fn(async ({ where }) => {
      const key = where.file_id_chunk_index; return chunks.get(`${key.file_id}:${key.chunk_index}`) ?? null;
    }),
    create: jest.fn(async ({ data }) => { events.push('chunk-create'); chunks.set(`${data.file_id}:${data.chunk_index}`, { ...data, data: Buffer.from(data.data) }); return data; }),
    aggregate: jest.fn(async ({ where }) => {
      const selected = [...chunks.values()].filter(chunk => matches(chunk, where));
      return { _count: { _all: selected.length }, _sum: { size_bytes: selected.reduce((sum, chunk) => sum + chunk.size_bytes, 0) || null } };
    }),
  };
  const audit = jest.fn(async () => ({}));
  const tx = { learnerLabFile: table, learnerLabFileChunk: chunkTable, auditLog: { create: audit } };
  const prisma = { ...tx, $transaction: jest.fn(async callback => {
    const oldFiles = new Map([...files].map(([key, value]) => [key, { ...value }]));
    const oldChunks = new Map(chunks);
    try { return await callback(tx); } catch (error) {
      files.clear(); oldFiles.forEach((value, key) => files.set(key, value));
      chunks.clear(); oldChunks.forEach((value, key) => chunks.set(key, value)); throw error;
    }
  }) };
  const access = { actor: jest.fn(async () => { events.push('authorize'); return alice; }) };
  const service = new LabFilesService(prisma as unknown as PrismaService, access as unknown as LearningAccessService);
  return { service, files, chunks, add, tx, table, chunkTable, access, audit, events };
}

describe('Private learner file service', () => {
  it.each(['photo.jpg', 'worksheet.pdf', 'README', 'page.html', 'program.exe'])
  ('stores and returns %s as exact opaque bytes with private metadata only', async name => {
    const f = fixture();
    const bytes = Buffer.from([0, 255, 13, 10]);
    const upload = await f.service.begin(alice, dto({ name }));
    expect(upload.chunkCount).toBe(1);
    expect(upload.chunkBytes).toBe(LAB_FILE_LIMITS.chunkBytes);
    expect((await f.service.list(alice, scope)).files).toEqual([]);
    await expect(f.service.getChunk(alice, upload.id, 0)).rejects.toThrow(NotFoundException);
    await f.service.putChunk(alice, upload.id, 0, bytes.toString('base64'));
    const completed = await f.service.complete(alice, upload.id);
    expect(completed).toEqual({ id: upload.id, name, sizeBytes: bytes.length, createdAt: expect.any(String) });
    expect((await f.service.getChunk(alice, upload.id, 0)).dataBase64).toBe(bytes.toString('base64'));
    const listed = await f.service.list(alice, scope);
    expect(listed.files).toEqual([completed]);
    expect(listed.usage).toEqual({ usedBytes: 4, reservedBytes: 0 });
    expect(listed.limits).toEqual(LAB_FILE_LIMITS);
    expect(JSON.stringify(listed)).not.toMatch(/dataBase64|client_upload_id|user_id|upload_expires_at/);
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain(bytes.toString('base64'));
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain(name);
    expect(f.access.actor).toHaveBeenCalledWith(f.tx, alice, 'learning:update');
    expect(f.access.actor).toHaveBeenCalledWith(f.tx, alice, 'learning:read');
  });

  it('hides another owner, lesson and platform and forbids all operations on another owner ID', async () => {
    const f = fixture();
    const upload = await f.service.begin(alice, dto());
    await f.service.putChunk(alice, upload.id, 0, Buffer.from('only').toString('base64'));
    await f.service.complete(alice, upload.id);
    expect((await f.service.list(bob, scope)).files).toEqual([]);
    expect((await f.service.list(alice, { ...scope, lessonId: 'timing' })).files).toEqual([]);
    expect((await f.service.list(alice, { ...scope, platformKey: 'phet' })).files).toEqual([]);
    await expect(f.service.getChunk(bob, upload.id, 0)).rejects.toThrow(NotFoundException);
    await expect(f.service.putChunk(bob, upload.id, 0, Buffer.from('leak').toString('base64'))).rejects.toThrow(NotFoundException);
    await expect(f.service.complete(bob, upload.id)).rejects.toThrow(NotFoundException);
    await expect(f.service.remove(bob, upload.id)).rejects.toThrow(NotFoundException);
    expect(f.files.get(upload.id)?.status).toBe('ready');
  });

  it('makes init/retry idempotent without allowing nonce reuse for a different payload', async () => {
    const f = fixture(); const first = dto();
    const upload = await f.service.begin(alice, first);
    expect(await f.service.begin(alice, first)).toEqual(upload);
    expect(f.table.create).toHaveBeenCalledTimes(1);
    await expect(f.service.begin(alice, { ...first, name: 'different.jpg' })).rejects.toThrow(ConflictException);
    await expect(f.service.begin(alice, { ...first, sizeBytes: 3 })).rejects.toThrow(ConflictException);
    await expect(f.service.begin(alice, { ...first, lessonId: 'timing' })).rejects.toThrow(ConflictException);
    const separate = await f.service.begin(bob, first);
    expect(separate.id).not.toBe(upload.id);
  });

  it('checks exact chunk lengths and indices, and allows identical retries after completion only', async () => {
    const f = fixture();
    const full = Buffer.alloc(LAB_FILE_LIMITS.chunkBytes, 0xa7), tail = Buffer.from('end');
    const upload = await f.service.begin(alice, dto({ sizeBytes: full.length + tail.length }));
    expect(upload.chunkCount).toBe(2);
    await expect(f.service.putChunk(alice, upload.id, -1, tail.toString('base64'))).rejects.toThrow(BadRequestException);
    await expect(f.service.putChunk(alice, upload.id, 2, tail.toString('base64'))).rejects.toThrow(BadRequestException);
    await expect(f.service.putChunk(alice, upload.id, 0, tail.toString('base64'))).rejects.toThrow(BadRequestException);
    await expect(f.service.putChunk(alice, upload.id, 1, full.toString('base64'))).rejects.toThrow(BadRequestException);
    await f.service.putChunk(alice, upload.id, 0, full.toString('base64'));
    await f.service.putChunk(alice, upload.id, 0, full.toString('base64'));
    expect(f.chunkTable.create).toHaveBeenCalledTimes(1);
    await expect(f.service.putChunk(alice, upload.id, 0, Buffer.alloc(full.length, 1).toString('base64'))).rejects.toThrow(ConflictException);
    await expect(f.service.complete(alice, upload.id)).rejects.toThrow(ConflictException);
    await f.service.putChunk(alice, upload.id, 1, tail.toString('base64'));
    const saved = await f.service.complete(alice, upload.id);
    expect(await f.service.complete(alice, upload.id)).toEqual(saved);
    expect(f.audit).toHaveBeenCalledTimes(1);
    await f.service.putChunk(alice, upload.id, 1, tail.toString('base64'));
    await expect(f.service.putChunk(alice, upload.id, 1, Buffer.from('new').toString('base64'))).rejects.toThrow(ConflictException);
    const first = await f.service.getChunk(alice, upload.id, 0), last = await f.service.getChunk(alice, upload.id, 1);
    expect(Buffer.concat([Buffer.from(first.dataBase64, 'base64'), Buffer.from(last.dataBase64, 'base64')])).toEqual(Buffer.concat([full, tail]));
  });

  it('completes a zero-byte file without inventing a chunk', async () => {
    const f = fixture(); const upload = await f.service.begin(alice, dto({ name: 'empty', sizeBytes: 0 }));
    expect(upload.chunkCount).toBe(0);
    expect((await f.service.complete(alice, upload.id)).sizeBytes).toBe(0);
    expect(f.chunkTable.create).not.toHaveBeenCalled();
    await expect(f.service.getChunk(alice, upload.id, 0)).rejects.toThrow(BadRequestException);
  });

  it('reserves the full declared size under current identity authorization and counts pending bytes in quota', async () => {
    const f = fixture();
    for (let index = 0; index < 9; index++) f.add({ size_bytes: LAB_FILE_LIMITS.fileBytes, chunk_count: 25, status: 'ready', upload_expires_at: null });
    const upload = await f.service.begin(alice, dto({ sizeBytes: LAB_FILE_LIMITS.fileBytes }));
    const result = await f.service.list(alice, scope);
    expect(result.usage).toEqual({ usedBytes: 9 * LAB_FILE_LIMITS.fileBytes, reservedBytes: LAB_FILE_LIMITS.fileBytes });
    await expect(f.service.begin(alice, dto({ sizeBytes: 1 }))).rejects.toThrow(PayloadTooLargeException);
    expect(f.events.slice(0, 3)).toEqual(['authorize', 'cleanup', 'usage']);
    await f.service.remove(alice, upload.id);
    await expect(f.service.begin(alice, dto({ sizeBytes: LAB_FILE_LIMITS.fileBytes }))).resolves.toMatchObject({ chunkCount: 25 });
  });

  it('applies account and per-lab count limits to both ready files and reservations', async () => {
    const f = fixture();
    for (let index = 0; index < 49; index++) f.add({ size_bytes: 0, chunk_count: 0, status: 'ready', upload_expires_at: null });
    await f.service.begin(alice, dto({ sizeBytes: 0 }));
    await expect(f.service.begin(alice, dto({ sizeBytes: 0 }))).rejects.toThrow(PayloadTooLargeException);
    await expect(f.service.begin(alice, dto({ sizeBytes: 0, lessonId: 'timing' }))).resolves.toMatchObject({ chunkCount: 0 });
    const many = fixture();
    const lessons = ['led', 'timing', 'distance', 'alarm', 'calibration', 'project'];
    const platforms = ['local', 'circuit', 'avr', 'wokwi', 'phet'];
    for (let index = 0; index < LAB_FILE_LIMITS.filesPerAccount; index++) many.add({
      lesson_slug: lessons[index % lessons.length], platform_key: platforms[Math.floor(index / lessons.length) % platforms.length],
      size_bytes: 0, chunk_count: 0, status: 'ready', upload_expires_at: null,
    });
    await expect(many.service.begin(alice, dto({ sizeBytes: 0 }))).rejects.toThrow(PayloadTooLargeException);
    expect(many.table.create).not.toHaveBeenCalled();
  });

  it('cleans expired reservations and their chunks for only the authenticated owner on list/init', async () => {
    const f = fixture();
    const expired = f.add({ upload_expires_at: new Date(Date.now() - 1), size_bytes: LAB_FILE_LIMITS.fileBytes, chunk_count: 25 });
    f.chunks.set(`${expired.id}:0`, { file_id: expired.id, chunk_index: 0, size_bytes: 1, data: Buffer.from('x') });
    const other = f.add({ user_id: bob.id, upload_expires_at: new Date(Date.now() - 1) });
    const ready = f.add({ status: 'ready', upload_expires_at: null });
    const listed = await f.service.list(alice, scope);
    expect(f.files.has(expired.id)).toBe(false);
    expect(f.chunks.size).toBe(0);
    expect(f.files.has(other.id)).toBe(true);
    expect(listed.files.map(file => file.id)).toEqual([ready.id]);
    expect(listed.usage).toEqual({ usedBytes: ready.size_bytes, reservedBytes: 0 });
    const another = f.add({ upload_expires_at: new Date(Date.now() - 1) });
    await f.service.begin(alice, dto());
    expect(f.files.has(another.id)).toBe(false);
  });

  it('rejects expired upload mutations until the learner starts a new upload', async () => {
    const f = fixture(); const expired = f.add({ upload_expires_at: new Date(Date.now() - 1) });
    await expect(f.service.putChunk(alice, expired.id, 0, Buffer.from('late').toString('base64'))).rejects.toThrow(GoneException);
    await expect(f.service.complete(alice, expired.id)).rejects.toThrow(GoneException);
    expect(f.chunkTable.create).not.toHaveBeenCalled();
  });

  it('deletes the file and its bytes and returns the released quota', async () => {
    const f = fixture(); const upload = await f.service.begin(alice, dto());
    await f.service.putChunk(alice, upload.id, 0, Buffer.from('only').toString('base64'));
    await f.service.complete(alice, upload.id);
    expect(await f.service.remove(alice, upload.id)).toEqual({ success: true });
    expect(f.files.size).toBe(0); expect(f.chunks.size).toBe(0);
    expect((await f.service.list(alice, scope)).usage).toEqual({ usedBytes: 0, reservedBytes: 0 });
    await expect(f.service.getChunk(alice, upload.id, 0)).rejects.toThrow(NotFoundException);
  });

  it('blocks all storage reads/writes when current session permissions have been revoked', async () => {
    const f = fixture(); const upload = await f.service.begin(alice, dto());
    await f.service.putChunk(alice, upload.id, 0, Buffer.from('only').toString('base64'));
    const files = [...f.files.values()], chunks = [...f.chunks.values()];
    f.access.actor.mockRejectedValue(new ForbiddenException('Revoked'));
    const reads = f.table.findMany.mock.calls.length;
    for (const operation of [
      () => f.service.list(alice, scope), () => f.service.begin(alice, dto()),
      () => f.service.putChunk(alice, upload.id, 0, Buffer.from('late').toString('base64')),
      () => f.service.getChunk(alice, upload.id, 0), () => f.service.complete(alice, upload.id),
      () => f.service.remove(alice, upload.id),
    ]) await expect(operation()).rejects.toThrow(ForbiddenException);
    expect([...f.files.values()]).toEqual(files); expect([...f.chunks.values()]).toEqual(chunks);
    expect(f.table.findMany.mock.calls.length).toBe(reads);
    expect(f.table.update).not.toHaveBeenCalled(); expect(f.table.delete).not.toHaveBeenCalled();
    expect(f.audit).not.toHaveBeenCalled();
  });
});
