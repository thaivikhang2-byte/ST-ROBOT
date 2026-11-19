import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PrismaClient } from '../src/database/client';
import { seed, seedForStartup, SEED_STARTUP_MARKER_KEY } from './seed';

function database() {
  const rows = new Map<string, Map<string, Record<string, any>>>();
  const queries: string[] = [];
  let sequence = 0;
  const table = (name: string) => {
    let values = rows.get(name);
    if (!values) { values = new Map(); rows.set(name, values); }
    return values;
  };
  const model = (name: string, unique: string) => ({
    upsert: jest.fn(async ({ where, create, update }) => {
      queries.push(`${name}.upsert`);
      const values = table(name), key = where[unique];
      const current = values.get(key);
      if (current) { Object.assign(current, update); return current; }
      const created = { id: `id-${++sequence}`, ...structuredClone(create) };
      values.set(key, created);
      return created;
    }),
  });
  const tx = {
    role: {
      createMany: jest.fn(async ({ data }) => {
        queries.push('role.createMany');
        const values = table('role');
        if (values.has(data.name)) return { count: 0 };
        values.set(data.name, { id: `role-${++sequence}`, is_active: true, ...structuredClone(data) });
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }) => {
        queries.push('role.findUniqueOrThrow');
        return table('role').get(where.name);
      }),
    },
    permission: model('permission', 'name'),
    rolePermission: model('rolePermission', 'role_id_permission_id'),
    aiProvider: model('aiProvider', 'id'),
    aiQuotaPolicy: model('aiQuotaPolicy', 'id'),
    setting: model('setting', 'key'),
    featureFlag: model('featureFlag', 'key'),
  };
  const setting = {
    ...tx.setting,
    findUnique: jest.fn(async ({ where }) => {
      queries.push('setting.findUnique');
      return table('setting').get(where.key) ?? null;
    }),
  };
  const transaction = jest.fn(async work => work(tx));
  const prisma = { setting, $transaction: transaction } as unknown as PrismaClient;
  return { prisma, tx, setting, transaction, queries, table };
}

describe('CLI database defaults source marker', () => {
  let log: jest.SpyInstance;
  beforeEach(() => { log = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => log.mockRestore());

  it('stamps the exact executing source only after initialization and skips all repeat upserts', async () => {
    const db = database();
    expect(await seedForStartup(db.prisma)).toEqual({ seeded: true });
    const expected = createHash('sha256').update(readFileSync(require.resolve('./seed'))).digest('hex');
    expect(db.table('setting').get(SEED_STARTUP_MARKER_KEY)?.value).toBe(expected);
    const firstQueryCount = db.queries.length;
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const coreCall = db.transaction.mock.invocationCallOrder[0];
    const markerCall = db.setting.upsert.mock.invocationCallOrder.at(-1)!;
    expect(markerCall).toBeGreaterThan(coreCall);

    db.queries.length = 0;
    // The exported core function remains unconditional and idempotent for explicit callers.
    await seed(db.prisma);
    const unoptimizedRepeatQueryCount = db.queries.length;
    expect(unoptimizedRepeatQueryCount).toBeGreaterThan(50);
    db.queries.length = 0;
    const transactions = db.transaction.mock.calls.length;
    expect(await seedForStartup(db.prisma)).toEqual({ seeded: false });
    expect(db.queries).toEqual(['setting.findUnique']);
    expect(db.transaction).toHaveBeenCalledTimes(transactions);
    expect(db.setting.findUnique).toHaveBeenLastCalledWith({
      where: { key: SEED_STARTUP_MARKER_KEY }, select: { value: true },
    });
    console.info(`Seed delegate query counts: first=${firstQueryCount}, repeat core=${unoptimizedRepeatQueryCount}, repeat CLI=${db.queries.length}`);
  });

  it('runs core defaults for an outdated source marker and preserves administrator changes', async () => {
    const db = database();
    await seedForStartup(db.prisma);
    db.table('setting').get(SEED_STARTUP_MARKER_KEY)!.value = 'old-source-hash';
    db.table('role').get('student')!.is_active = false;
    db.table('setting').get('site.name')!.value = 'Administrator title';
    db.table('featureFlag').get('registration')!.is_enabled = false;
    db.table('rolePermission').clear();
    db.tx.rolePermission.upsert.mockClear();
    db.queries.length = 0;
    expect(await seedForStartup(db.prisma)).toEqual({ seeded: true });
    expect(db.queries).toContain('permission.upsert');
    expect(db.table('role').get('student')!.is_active).toBe(false);
    expect(db.table('setting').get('site.name')!.value).toBe('Administrator title');
    expect(db.table('featureFlag').get('registration')!.is_enabled).toBe(false);
    expect(db.tx.rolePermission.upsert).not.toHaveBeenCalled();
    expect(db.table('rolePermission').size).toBe(0);
    expect(db.table('setting').get(SEED_STARTUP_MARKER_KEY)!.value).not.toBe('old-source-hash');
  });

  it('does not probe or repair missing roles or revoked grants when the exact source completed', async () => {
    const db = database();
    await seedForStartup(db.prisma);
    db.table('role').delete('teacher');
    db.table('rolePermission').clear();
    db.queries.length = 0;
    expect(await seedForStartup(db.prisma)).toEqual({ seeded: false });
    expect(db.queries).toEqual(['setting.findUnique']);
    expect(db.table('role').has('teacher')).toBe(false);
    expect(db.table('rolePermission').size).toBe(0);
  });

  it.each([undefined, 'old-source-hash'])('never stamps after a failed core seed (old marker %s)', async previous => {
    const db = database();
    if (previous) db.table('setting').set(SEED_STARTUP_MARKER_KEY, { value: previous });
    db.tx.role.createMany.mockRejectedValueOnce(new Error('fixture seed failure'));
    await expect(seedForStartup(db.prisma)).rejects.toThrow('fixture seed failure');
    expect(db.setting.upsert).not.toHaveBeenCalled();
    expect(db.table('setting').get(SEED_STARTUP_MARKER_KEY)?.value).toBe(previous);
  });

  it('retries initialization next time if the successful seed could not persist its marker', async () => {
    const db = database();
    db.setting.upsert.mockRejectedValueOnce(new Error('fixture marker failure'));
    await expect(seedForStartup(db.prisma)).rejects.toThrow('fixture marker failure');
    expect(db.table('setting').has(SEED_STARTUP_MARKER_KEY)).toBe(false);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(await seedForStartup(db.prisma)).toEqual({ seeded: true });
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db.table('setting').has(SEED_STARTUP_MARKER_KEY)).toBe(true);
  });

  it('does not run or stamp defaults if the marker lookup fails', async () => {
    const db = database();
    db.setting.findUnique.mockRejectedValueOnce(new Error('fixture database unavailable'));
    await expect(seedForStartup(db.prisma)).rejects.toThrow('fixture database unavailable');
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });
});
