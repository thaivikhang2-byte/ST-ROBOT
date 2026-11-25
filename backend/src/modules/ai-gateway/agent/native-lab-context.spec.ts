import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../../database/prisma.service';
import { ownLearningData, siteLabResources, siteLessonContext } from './site-learning-context';
import { siteLabWorkflows } from './site-lab-workflows';

function database(values: Record<string, string>) {
  return { learnerState: { findUnique: jest.fn().mockResolvedValue({ values, summary: {}, revision: 8, updated_at: new Date(0) }) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) } };
}
const courseKey = 'strobot.original.course.v3';
const projectBody = 'private robot and world contents never forwarded to AI';
const encoded = Buffer.from(projectBody).toString('base64');
const work = { version: 2, savedAt: '2026-11-25T08:00:00Z', code: 'api_key="never-forward-this-key"\nprint("selected-source")',
  notes: 'Saved before changing the robot world', projectUrl: 'https://example.test/project?token=never-forward-query', fileName: 'main.py',
  files: [{ name: 'robot.zip', dataBase64: encoded }, { name: 'Map_config.json', dataBase64: encoded }] };

describe('Bounded owner-only native project context', () => {
  it('uses the generated platform save/reopen workflow as trusted lesson guidance', () => {
    const context = siteLessonContext('vex-iq', 'drive', 'gears');
    expect(context.nativeSavingWorkflow).toEqual({ platformKey: 'gears', ...siteLabWorkflows.gears });
    expect(context.nativeSavingWorkflow?.saveSteps.join(' ')).toContain('ZIP');
    expect(context.nativeSavingWorkflow?.reopenSteps.join(' ')).toContain('Worlds');
    expect(siteLessonContext('arduino', 'led')).not.toHaveProperty('nativeSavingWorkflow');
  });

  it('exposes v2 source and native filenames only for the selected owner, lesson and lab', async () => {
    const db = database({ [courseKey]: JSON.stringify({ 'vex-iq': { drive: { labWork: { gears: work, local: { ...work, code: 'other-lab-private' } } },
      turn: { labWork: { gears: { ...work, code: 'other-lesson-private' } } } } }) });
    const result = await ownLearningData(db as unknown as PrismaService, 'verified-session-owner', 'vex-iq', 'drive', 'gears');
    expect(db.learnerState.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: 'verified-session-owner' } }));
    expect((result.courses[0].lessons as Array<Record<string, unknown>>)[0].labWork).toMatchObject({
      source: 'saved-learner-lab-copy', fileCount: 2, fileNames: ['robot.zip', 'Map_config.json'], fileContentsIncluded: false,
    });
    expect(JSON.stringify(result)).toContain('selected-source');
    expect(JSON.stringify(result)).not.toMatch(/never-forward|other-lab-private|other-lesson-private|dataBase64/);
    expect(JSON.stringify(result)).not.toContain(encoded);
    expect(JSON.stringify(result)).not.toContain(projectBody);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8500);
    const overview = await ownLearningData(db as unknown as PrismaService, 'verified-session-owner');
    const unselected = await ownLearningData(db as unknown as PrismaService, 'verified-session-owner', 'vex-iq', 'drive');
    for (const value of [overview, unselected]) expect(JSON.stringify(value)).not.toMatch(/robot\.zip|Map_config\.json|selected-source|dataBase64/);
  });

  it('keeps multilingual native metadata and escaped source inside the serialized tool budget', async () => {
    const full = { ...work, code: '👩‍💻\n\t"'.repeat(3000), notes: 'Ghi chú 👩‍💻\n"'.repeat(1000),
      files: Array.from({ length: 4 }, (_, index) => ({ name: 'ệ'.repeat(110) + index + '.zip', dataBase64: encoded })) };
    const db = database({ [courseKey]: JSON.stringify({ 'vex-iq': { drive: { labWork: { gears: full } } } }) });
    const result = await ownLearningData(db as unknown as PrismaService, 'owner', 'vex-iq', 'drive', 'gears');
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8500);
    expect(JSON.stringify(result)).not.toContain(encoded);
  });

  it('retains archive existence without recommending or reading retired Scratch/Arcade projects', async () => {
    const db = database({ [courseKey]: JSON.stringify({ microbit: { matrix: { labWork: { scratch: { version: 1, code: 'archived-private-work' } } } } }) });
    const result = await ownLearningData(db as unknown as PrismaService, 'owner', 'microbit', 'matrix');
    expect((result.courses[0].lessons as Array<Record<string, unknown>>)[0]).toMatchObject({ hasArchivedLabWork: true, hasSavedLabWork: false });
    expect(JSON.stringify(result)).not.toContain('archived-private-work');
    expect(siteLabResources('microbit').courses[0].platforms.map(platform => platform.key)).toEqual(['python', 'local']);
    await expect(ownLearningData(db as unknown as PrismaService, 'owner', 'microbit', 'matrix', 'scratch')).rejects.toThrow(BadRequestException);
  });

  it('reports native microbit numeric save times as ISO without leaking other project files', async () => {
    const savedAt = Date.UTC(2026, 10, 25, 8);
    const db = database({ 'strobot.microbit.editor.v1.matrix': JSON.stringify({ version: 1, courseId: 'microbit', lessonId: 'matrix', savedAt,
      project: { projectName: 'My matrix', files: { 'main.py': Buffer.from('print("main only")').toString('base64'), 'private.bin': encoded } } }) });
    const result = await ownLearningData(db as unknown as PrismaService, 'owner', 'microbit', 'matrix', 'python');
    expect(result.project).toMatchObject({ source: 'saved-microbit-editor', savedAt: new Date(savedAt).toISOString(), mainPython: 'print("main only")' });
    expect(JSON.stringify(result)).not.toMatch(/private\.bin|dataBase64/);
    expect(JSON.stringify(result)).not.toContain(encoded);
  });
});
