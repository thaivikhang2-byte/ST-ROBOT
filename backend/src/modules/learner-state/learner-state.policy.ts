import { BadRequestException } from '@nestjs/common';

export const courseLessons: Readonly<Record<string, readonly string[]>> = Object.freeze({
  arduino: ['led', 'timing', 'distance', 'alarm', 'calibration', 'project'],
  'vex-iq': ['drive', 'turn', 'detect', 'mission', 'odometry', 'control'],
  microbit: ['matrix', 'buttons', 'light', 'counter', 'radio', 'project'],
  'lego-spike': ['mechanism', 'colors', 'sort', 'project', 'ratio', 'state'],
  'vex-vr': ['sequence', 'loop', 'avoid', 'challenge', 'search', 'experiment'],
});
export const snapshotByteLimit = 8 * 1024 * 1024;
const limits: Record<string, number> = {
  'strobot.original.course.v3': 5 * 1024 * 1024,
  'strobot.quiz.history.v1': 128 * 1024,
  'strobot.review.evidence.v1': 1024 * 1024,
  'strobot.assessment.v1': 2 * 1024 * 1024,
  'strobot.learning.level.v1': 16,
  ...Object.fromEntries(courseLessons.microbit.map(id => [`strobot.microbit.editor.v1.${id}`, 750000])),
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(reason: string): never { throw new BadRequestException(reason); }
const course = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(courseLessons, id);
const lesson = (courseId: string, id: unknown): id is string => typeof id === 'string' && courseLessons[courseId].includes(id);
const time = (value: unknown) => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const short = (value: unknown, length: number) => typeof value === 'string' && value.length <= length && !value.includes('\u0000');

function projectUrl(value: string) {
  if (value === '') return;
  let parsed: URL;
  try { parsed = new URL(value); } catch { fail('Invalid project URL'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) fail('Project URLs must use HTTPS without credentials');
}

function safeTree(value: unknown, budget: { count: number }, depth = 0): void {
  if (++budget.count > 100000 || depth > 24) fail('Learner data structure exceeds limits');
  if (typeof value === 'number' && !Number.isFinite(value)) fail('Learner data contains an invalid number');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Unsafe learner data key');
    safeTree(child, budget, depth + 1);
  }
}

function validateCourseState(value: unknown) {
  if (!object(value)) fail('Invalid course state');
  for (const [courseId, records] of Object.entries(value)) {
    if (courseId === 'last') { if (!course(records)) fail('Unknown last course'); continue; }
    if (!course(courseId) || !object(records)) fail('Unknown course or invalid course records');
    for (const [lessonId, record] of Object.entries(records)) {
      if (!lesson(courseId, lessonId) || !object(record)) fail('Unknown lesson or invalid lesson record');
      const textLimits: Record<string, number> = { note: 15000, prediction: 2000, observation: 3000, explanation: 3000, transfer: 2000, projectUrl: 2048 };
      for (const [field, item] of Object.entries(record)) {
        if (Object.hasOwn(textLimits, field)) {
          if (!short(item, textLimits[field])) fail('Invalid lesson text');
          if (field === 'projectUrl') projectUrl(item as string);
        }
        else if (field === 'done') { if (typeof item !== 'boolean') fail('Invalid lesson completion'); }
        else if (field === 'choice') { if (item !== null && (!Number.isInteger(item) || Number(item) < 0 || Number(item) > 99)) fail('Invalid lesson choice'); }
        else if (field === 'source') { if (typeof item !== 'string' || !['', 'local-model', 'external', 'hardware'].includes(item)) fail('Invalid practice source'); }
        else if (field === 'completionSource') { if (typeof item !== 'string' || !['self-report', 'imported-self-report'].includes(item)) fail('Invalid completion source'); }
        else if (field === 'completedAt') { if (!time(item)) fail('Invalid completion time'); }
        else if (field === 'modelEvidence') {
          if (item === null) continue;
          if (!object(item) || item.kind !== 'local-model' || item.lessonId !== lessonId || !short(item.summary, 2000) || !Array.isArray(item.actions) || item.actions.length > 40 || item.actions.some(action => !short(action, 200)) || (item.prediction !== undefined && !short(item.prediction, 2000))) fail('Invalid model evidence');
        } else fail('Unsupported lesson record field');
      }
    }
  }
}

function validateQuizHistory(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) fail('Invalid quiz history');
  for (const row of value) {
    if (!object(row) || !short(row.id, 160) || !course(row.courseId) || !(row.lessonId === 'all' || lesson(row.courseId, row.lessonId)) || !Number.isInteger(row.correct) || !Number.isInteger(row.total) || Number(row.total) < 1 || Number(row.total) > 500 || Number(row.correct) < 0 || Number(row.correct) > Number(row.total) || typeof row.percentage !== 'number' || row.percentage < 0 || row.percentage > 100 || !time(row.createdAt)) fail('Invalid quiz history record');
  }
}

function validateReview(value: unknown) {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.attempts) || value.attempts.length > 120) fail('Invalid practice history');
  for (const row of value.attempts) {
    if (!object(row) || !short(row.id, 160) || !course(row.courseId) || typeof row.mode !== 'string' || !['quiz', 'review', 'generated'].includes(row.mode) || !time(row.completedAt) || !Array.isArray(row.answers) || row.answers.length > 500 || row.answers.some(answer => !object(answer) || !short(answer.questionId, 160) || !Number.isInteger(answer.choice) || Number(answer.choice) < 0 || Number(answer.choice) > 99)) fail('Invalid practice attempt');
  }
}

function validateAssessment(value: unknown) {
  if (!object(value) || value.version !== 'arduino-prepost-v1' || !Array.isArray(value.participants) || value.participants.length > 200) fail('Invalid assessment archive');
  const codes = new Set();
  for (const row of value.participants) {
    if (!object(row) || typeof row.code !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(row.code) || codes.has(row.code) || typeof row.group !== 'string' || !['fixed', 'adaptive'].includes(row.group) || typeof row.order !== 'string' || !['AB', 'BA'].includes(row.order) || !time(row.createdAt) || !object(row.stages) || Object.keys(row.stages).some(key => !['pre', 'post'].includes(key))) fail('Invalid assessment participant');
    codes.add(row.code);
  }
}

function validateMicrobit(key: string, value: unknown) {
  const lessonId = key.slice('strobot.microbit.editor.v1.'.length);
  if (!object(value) || value.version !== 1 || value.courseId !== 'microbit' || value.lessonId !== lessonId || !Number.isFinite(value.savedAt) || !object(value.project) || !object(value.project.files)) fail('Invalid microbit project record');
  const files = Object.entries(value.project.files);
  if (files.length < 1 || files.length > 16 || !Object.hasOwn(value.project.files, 'main.py')) fail('Invalid microbit project files');
  let bytes = 0;
  for (const [name, encoded] of files) {
    if (!name || name.length > 80 || name.includes('..') || /[\/\\\u0000-\u001f\u007f]/.test(name) || typeof encoded !== 'string' || encoded.length > 349528 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('Invalid microbit project file');
    const decoded = Buffer.from(encoded, 'base64');
    bytes += decoded.length;
    if (decoded.length > 256 * 1024 || bytes > 512 * 1024 || decoded.toString('base64') !== encoded) fail('Microbit project exceeds limits');
    if (name === 'main.py') {
      try { new TextDecoder('utf-8', { fatal: true }).decode(decoded); } catch { fail('Microbit main.py must contain valid UTF-8'); }
    }
  }
  if (value.project.projectName !== undefined && (!short(value.project.projectName, 80) || /[\u0000-\u001f\u007f]/.test(value.project.projectName as string))) fail('Invalid microbit project name');
}

export function validateValues(input: unknown): Record<string, string> {
  if (!object(input) || Object.keys(input).length > Object.keys(limits).length) fail('Invalid learner snapshot');
  const result: Record<string, string> = {};
  let bytes = 0;
  for (const [key, raw] of Object.entries(input)) {
    if (!Object.hasOwn(limits, key) || typeof raw !== 'string') fail('Unsupported learner storage key');
    const size = Buffer.byteLength(raw, 'utf8');
    bytes += size;
    if (size > limits[key] || bytes > snapshotByteLimit) fail('Learner snapshot exceeds storage limits');
    if (key === 'strobot.learning.level.v1') {
      if (!['beginner', 'intermediate', 'advanced'].includes(raw)) fail('Invalid learning preference');
    } else {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { fail('Learner values must contain valid JSON'); }
      safeTree(parsed, { count: 0 });
      if (key === 'strobot.original.course.v3') validateCourseState(parsed);
      else if (key === 'strobot.quiz.history.v1') validateQuizHistory(parsed);
      else if (key === 'strobot.review.evidence.v1') validateReview(parsed);
      else if (key === 'strobot.assessment.v1') validateAssessment(parsed);
      else validateMicrobit(key, parsed);
    }
    result[key] = raw;
  }
  return result;
}

export function summarizeValues(values: Record<string, string>) {
  const state = JSON.parse(values['strobot.original.course.v3'] ?? '{}') as Record<string, Record<string, { done?: boolean }>>;
  const quiz = JSON.parse(values['strobot.quiz.history.v1'] ?? '[]') as { courseId: string }[];
  const review = JSON.parse(values['strobot.review.evidence.v1'] ?? '{"attempts":[]}') as { attempts: { courseId: string }[] };
  return {
    source: 'learner-self-report',
    courses: Object.entries(courseLessons).map(([courseId, ids]) => ({
      courseId,
      totalLessons: ids.length,
      completedLessons: ids.filter(id => state[courseId]?.[id]?.done === true).length,
      savedLessons: ids.filter(id => object(state[courseId]?.[id])).length,
      quizAttempts: quiz.filter(row => row.courseId === courseId).length,
      practiceAttempts: review.attempts.filter(row => row.courseId === courseId).length,
    })),
  };
}

export function validateActivityCourse(courseId?: string, lessonId?: string) {
  if (courseId !== undefined && !course(courseId)) fail('Unknown activity course');
  if (lessonId !== undefined && (!courseId || !lesson(courseId, lessonId))) fail('Unknown activity lesson');
}
