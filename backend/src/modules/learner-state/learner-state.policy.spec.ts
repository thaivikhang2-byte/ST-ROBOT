import { BadRequestException } from '@nestjs/common';
import { courseLessons, summarizeValues, validateActivityCourse, validateValues } from './learner-state.policy';

describe('Learner snapshot boundary', () => {
  const courseState = { last: 'arduino', arduino: { led: { note: 'A learner reflection', done: true, choice: 0, completionSource: 'self-report' } } };
  it('round-trips approved storage strings and reports completion as self-report only', () => {
    const values = { 'strobot.original.course.v3': JSON.stringify(courseState), 'strobot.learning.level.v1': 'beginner' };
    expect(validateValues(values)).toEqual(values);
    expect(summarizeValues(values)).toMatchObject({ source: 'learner-self-report', courses: expect.arrayContaining([{ courseId: 'arduino', totalLessons: 6, completedLessons: 1, savedLessons: 1, quizAttempts: 0, practiceAttempts: 0 }]) });
  });
  it.each(['auth.accessToken', 'strobot.account.user', '__proto__', 'strobot.microbit.editor.v1.unknown'])('refuses unsupported account or storage key %s', key => {
    expect(() => validateValues(JSON.parse(JSON.stringify({ [key]: '{}' })))).toThrow(BadRequestException);
  });
  it('refuses unknown lessons, nonboolean completion, or a claim of verified completion', () => {
    for (const record of [{ unknown: { done: true } }, { led: { done: 'true' } }, { led: { done: true, completionSource: 'verified' } }]) {
      expect(() => validateValues({ 'strobot.original.course.v3': JSON.stringify({ arduino: record }) })).toThrow(BadRequestException);
    }
  });
  it('rejects nested prototype keys and nonfinite numbers before persistence', () => {
    expect(() => validateValues({ 'strobot.original.course.v3': '{"arduino":{"led":{"__proto__":{"polluted":true}}}}' })).toThrow(BadRequestException);
    expect(() => validateValues({ 'strobot.original.course.v3': '{"arduino":{"led":{"choice":1e999}}}' })).toThrow(BadRequestException);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('bounds exact official microbit project records and rejects cross-lesson project injection', () => {
    const project = { version: 1, courseId: 'microbit', lessonId: 'matrix', savedAt: Date.now(), project: { files: { 'main.py': Buffer.from('print("hello")').toString('base64') }, projectName: 'Lesson' } };
    const key = 'strobot.microbit.editor.v1.matrix';
    expect(validateValues({ [key]: JSON.stringify(project) })[key]).toBe(JSON.stringify(project));
    expect(() => validateValues({ [key]: JSON.stringify({ ...project, lessonId: 'radio' }) })).toThrow(BadRequestException);
    expect(() => validateValues({ [key]: JSON.stringify({ ...project, project: { files: { 'main.py': 'not base64!' } } }) })).toThrow(BadRequestException);
    expect(() => validateValues({ [key]: JSON.stringify({ ...project, project: { files: { 'main.py': Buffer.from([255, 254]).toString('base64') } } }) })).toThrow(BadRequestException);
    expect(() => validateValues({ [key]: JSON.stringify({ ...project, project: { ...project.project, projectName: 'bad\nname' } }) })).toThrow(BadRequestException);
  });
  it('rejects over-limit history and oversized journal fields', () => {
    expect(() => validateValues({ 'strobot.quiz.history.v1': JSON.stringify(Array(21).fill({})) })).toThrow(BadRequestException);
    expect(() => validateValues({ 'strobot.original.course.v3': JSON.stringify({ arduino: { led: { note: 'a'.repeat(15001) } } }) })).toThrow(BadRequestException);
  });
  it('accepts full Vietnamese journals for all five approved courses within field limits', () => {
    const record = { note: 'ệ'.repeat(15000), prediction: 'ệ'.repeat(2000), observation: 'ệ'.repeat(3000), explanation: 'ệ'.repeat(3000), transfer: 'ệ'.repeat(2000), done: false };
    const state = Object.fromEntries(Object.entries(courseLessons).map(([id, lessons]) => [id, Object.fromEntries(lessons.map(lessonId => [lessonId, record]))]));
    const raw = JSON.stringify(state);
    expect(Buffer.byteLength(raw)).toBeGreaterThan(2 * 1024 * 1024);
    expect(validateValues({ 'strobot.original.course.v3': raw })['strobot.original.course.v3']).toBe(raw);
  });
  it('rejects executable project links and embedded credentials during cross-device restore', () => {
    for (const url of ['javascript:alert(1)', 'https://private:secret@example.com/project']) {
      expect(() => validateValues({ 'strobot.original.course.v3': JSON.stringify({ arduino: { led: { projectUrl: url } } }) })).toThrow(BadRequestException);
    }
    expect(() => validateValues({ 'strobot.original.course.v3': JSON.stringify({ arduino: { led: { projectUrl: 'https://example.com/project' } } }) })).not.toThrow();
  });
  it('requires activity lesson to belong to its canonical course', () => {
    expect(() => validateActivityCourse('microbit', 'matrix')).not.toThrow();
    expect(() => validateActivityCourse('arduino', 'matrix')).toThrow(BadRequestException);
    expect(() => validateActivityCourse(undefined, 'matrix')).toThrow(BadRequestException);
  });
});
