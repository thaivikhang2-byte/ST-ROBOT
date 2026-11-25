import { BadRequestException } from '@nestjs/common';
import { ForbiddenException, RequestUser } from '../../shared/sdk';
import { PrismaService } from '../../database/prisma.service';
import { LearningAccessService } from '../progress/learning-access.service';
import { LearnerStateService } from './learner-state.service';
import { courseLessons, summarizeValues, validateValues } from './learner-state.policy';

const courseKey = 'strobot.original.course.v3';
const file = (name: string, content = 'private native project') => ({ name, dataBase64: Buffer.from(content).toString('base64') });
const work = (files: unknown[] = []) => ({ version: 2, savedAt: '2026-11-25T08:00:00.000Z',
  code: 'private saved source', notes: 'private checkpoint', projectUrl: 'https://example.test/private-project',
  fileName: 'main.py', files });
function values(saved: unknown, platform = 'wokwi', course = 'arduino', lesson = 'led') {
  return { [courseKey]: JSON.stringify({ [course]: { [lesson]: { labWork: { [platform]: saved } } } }) };
}

describe('Account-native lab project boundaries', () => {
  it.each([
    ['arduino', 'led', 'circuit', 'circuit.txt'], ['arduino', 'led', 'avr', 'sketch.ino'],
    ['arduino', 'led', 'avr', 'project.zip'], ['arduino', 'led', 'wokwi', 'diagram.json'],
    ['arduino', 'led', 'wokwi', 'sketch.ino'], ['microbit', 'matrix', 'python', 'program.hex'],
    ['microbit', 'matrix', 'python', 'project.zip'], ['vex-iq', 'drive', 'gears', 'blocks.xml'],
    ['lego-spike', 'mechanism', 'gears', 'Map_config.json'], ['vex-vr', 'sequence', 'gears', 'robot.zip'],
  ])('preserves exact %s/%s/%s native file %s without exposing it to management summaries', (course, lesson, platform, name) => {
    const input = values(work([file(name)]), platform, course, lesson);
    expect(validateValues(input)).toEqual(input);
    expect(JSON.stringify(summarizeValues(input))).not.toMatch(/private|dataBase64|main\.py|\.zip|\.xml|\.json/);
  });

  it('retains existing v1 and archived platform work while v2 adds no new lab choices', () => {
    const { files, ...legacy } = { ...work(), version: 1 };
    for (const [platform, course, lesson] of [
      ['scratch', 'microbit', 'matrix'], ['arcade', 'vex-iq', 'drive'],
      ['phet', 'arduino', 'led'], ['local', 'lego-spike', 'mechanism'],
    ]) expect(validateValues(values(legacy, platform, course, lesson))).toEqual(values(legacy, platform, course, lesson));
    expect(validateValues(values(work([file('old-project.sb3')]), 'scratch', 'microbit', 'matrix')))
      .toEqual(values(work([file('old-project.sb3')]), 'scratch', 'microbit', 'matrix'));
    expect(() => validateValues(values(work([file('main.py')]), 'python'))).toThrow(BadRequestException);
    expect(() => validateValues(values(work([file('unknown.txt')]), 'unknown'))).toThrow(BadRequestException);
    expect(files).toEqual([]);
  });

  it.each(['phet', 'local'])('preserves legacy source fields but refuses native attachments for %s', platform => {
    expect(validateValues(values(work(), platform))).toEqual(values(work(), platform));
    expect(() => validateValues(values(work([file('result.txt')]), platform))).toThrow(BadRequestException);
  });

  it('accepts the exact 256 KiB project limit and rejects a larger single file or combined project', () => {
    const full = { name: 'project.zip', dataBase64: Buffer.alloc(256 * 1024, 1).toString('base64') };
    expect(validateValues(values(work([full])))).toEqual(values(work([full])));
    const quarter = Buffer.alloc(64 * 1024, 2).toString('base64');
    const four = ['a.ino', 'b.json', 'c.h', 'd.txt'].map(name => ({ name, dataBase64: quarter }));
    expect(validateValues(values(work(four)))).toEqual(values(work(four)));
    expect(() => validateValues(values(work([{ ...full, dataBase64: Buffer.alloc(256 * 1024 + 1).toString('base64') }])))).toThrow(BadRequestException);
    expect(() => validateValues(values(work([full, file('one-more.txt', 'x')])))).toThrow(BadRequestException);
    expect(() => validateValues(values(work([...four, file('fifth.txt')])))).toThrow(BadRequestException);
  });

  it('rejects malformed files, cross-platform formats, ambiguous names and spoofed ownership', () => {
    const invalid = [
      { ...work(), files: undefined }, { ...work(), version: '2' }, { ...work(), ownerId: 'other-user' },
      work([file('../project.zip')]), work([file('folder/project.zip')]), work([file('folder\\project.zip')]),
      work([file('project..zip')]), work([file('bad\0.zip')]), work([file('')]),
      work([file('a'.repeat(121) + '.zip')]), work([file('project.exe')]), work([file('blocks.xml')]),
      work([file('main.ino'), file('MAIN.INO')]), work([{ ...file('main.ino'), ownerId: 'other-user' }]),
      work([{ name: 'main.ino', dataBase64: 'not base64' }]),
      work([{ name: 'main.ino', dataBase64: 'Zh==' }]), // Decodes like Zg== but is not canonical.
      work([{ name: 'main.ino', dataBase64: 'Zg==\n' }]),
    ];
    for (const saved of invalid) expect(() => validateValues(values(saved))).toThrow(BadRequestException);
    const old = { ...work(), version: 1 };
    expect(() => validateValues(values(old))).toThrow(BadRequestException); // v1 cannot smuggle the new field.
  });

  it('keeps the course quota authoritative when individually valid projects exceed it together', () => {
    const project = work([{ name: 'project.zip', dataBase64: Buffer.alloc(256 * 1024, 3).toString('base64') }]);
    let remaining = 16;
    const state = Object.fromEntries(Object.entries(courseLessons).map(([course, lessons]) => [course,
      Object.fromEntries(lessons.flatMap(lesson => remaining-- > 0
        ? [[lesson, { labWork: { [course === 'arduino' ? 'wokwi' : course === 'microbit' ? 'python' : 'gears']: project } }]] : []))]));
    expect(() => validateValues({ [courseKey]: JSON.stringify(state) })).toThrow(BadRequestException);
  });

  it('round-trips native files by session owner and still rejects stale revisions or revoked writes', async () => {
    const records = new Map<string, { revision: number; values: Record<string, string>; summary: unknown; updated_at: Date }>();
    const audit = jest.fn().mockResolvedValue({});
    const table = {
      findUnique: jest.fn(async ({ where }) => records.get(where.user_id) ?? null),
      create: jest.fn(async ({ data }) => { const row = { ...data, updated_at: new Date() }; records.set(data.user_id, row); return row; }),
      update: jest.fn(async ({ where, data }) => { const row = { ...data, updated_at: new Date() }; records.set(where.user_id, row); return row; }),
    };
    const tx = { learnerState: table, auditLog: { create: audit } };
    const access = { actor: jest.fn().mockResolvedValue({}) };
    const db = { ...tx, $transaction: jest.fn(async callback => callback(tx)) };
    const service = new LearnerStateService(db as unknown as PrismaService, access as unknown as LearningAccessService);
    const alice = { id: 'alice-session-owner' } as RequestUser, bob = { id: 'bob-session-owner' } as RequestUser;
    const input = values(work([file('diagram.json'), file('project.zip')]));
    const saved = await service.save(alice, { revision: 0, values: input });
    expect(saved.revision).toBe(1);
    expect((await service.get(alice)).values).toEqual(input);
    expect((await service.get(bob)).values).toEqual({});
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/private|dataBase64|diagram\.json|project\.zip/);
    await expect(service.save(alice, { revision: 0, values: {} })).rejects.toThrow();
    expect((await service.get(alice)).values).toEqual(input);
    access.actor.mockRejectedValue(new ForbiddenException());
    await expect(service.save(alice, { revision: 1, values: {} })).rejects.toThrow(ForbiddenException);
    expect((await service.get(alice)).values).toEqual(input);
    expect(table.update).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
  });
});
