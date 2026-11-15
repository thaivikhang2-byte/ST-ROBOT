import assert from 'node:assert/strict';
import { workspaceAccess, canUpdateStudentStatus, readLearningDashboard } from '../frontend/src/modules/account/LearningDashboard.js';
import { quizQuestions } from '../frontend/src/data/quiz.js';

const student = { id: 'student-a', isEmailVerified: true, role: { name: 'student' }, roles: [{ group: 'STUDENT', scopeType: 'SELF' }], permissions: ['learning:read'] };
const manager = { id: 'manager-a', isEmailVerified: true, role: { name: 'superadmin' }, roles: [{ group: 'MANAGER', scopeType: 'SYSTEM' }], permissions: ['dashboard:read', 'users:update', 'users:create'] };
assert.equal(workspaceAccess(student).label, 'Học sinh');
assert.equal(workspaceAccess(student).management, false);
assert.equal(workspaceAccess({ ...student, permissions: manager.permissions }).management, false, 'permission-looking data alone cannot turn a student profile into staff UI');
assert.equal(workspaceAccess(manager).management, true);
assert.equal(workspaceAccess({ ...manager, permissions: ['ai:manage'] }).management, true);
assert.equal(workspaceAccess({ ...manager, permissions: [] }).management, false);
assert.equal(workspaceAccess(manager, { offline: true }).management, false);
assert.equal(workspaceAccess({ ...manager, isEmailVerified: false }).management, false);
assert.equal(canUpdateStudentStatus(manager, student), true);
assert.equal(canUpdateStudentStatus(manager, manager), false);
assert.equal(canUpdateStudentStatus(manager, { ...student, roles: [...student.roles, { group: 'TEACHER', scopeType: 'COURSE' }] }), false);
assert.equal(canUpdateStudentStatus(manager, { ...student, role: { name: 'admin' } }), false);
assert.equal(canUpdateStudentStatus({ ...manager, permissions: ['users:read'] }, student), false);
assert.equal(canUpdateStudentStatus(manager, student, { offline: true }), false);
assert.equal(canUpdateStudentStatus(manager, { ...student, isActive: false, roles: [], management: { studentOnly: true, roleGroups: ['STUDENT'] } }), true);
assert.equal(canUpdateStudentStatus(manager, { ...student, isActive: false, roles: [] }), false, 'legacy role name alone cannot authorize a disabled account action');
assert.equal(canUpdateStudentStatus(manager, { ...student, isActive: false, roles: [], management: { studentOnly: false, roleGroups: ['STUDENT', 'TEACHER'] } }), false);

const values = {
    'strobot.original.course.v3': JSON.stringify({ last: 'arduino', arduino: {
        led: { done: true, note: 'A private journal that must not be included in a summary' }, timing: { done: false, note: '' },
    }, unknownCourse: { fake: { done: true } } }),
    'strobot.quiz.history.v1': JSON.stringify([
        { id: 'quiz-1', courseId: 'arduino', lessonId: 'all', total: 3, correct: 2, percentage: 67, createdAt: '2026-11-14T00:00:00Z', secretExtra: 'must not leave storage' },
        { courseId: 'unknownCourse', total: 3, correct: 3, percentage: 100, createdAt: '2026-11-14T01:00:00Z' },
        { courseId: 'arduino', total: 3, correct: 4, percentage: 133, createdAt: '2026-11-14T02:00:00Z' },
    ]),
    'strobot.review.evidence.v1': JSON.stringify({ version: 1, attempts: [
        ...['generated', 'quiz', 'review'].map((mode, index) => ({
            id: `practice-${index}`, courseId: 'arduino', mode, completedAt: '2026-11-14T00:00:00Z',
            answers: [{ questionId: quizQuestions.find(question => question.courseId === 'arduino').id, choice: 0 }],
        })),
        { id: 'incomplete', courseId: 'arduino', mode: 'review' },
        { id: 'invalid-questions', courseId: 'arduino', mode: 'review', completedAt: '2026-11-14T00:00:00Z', answers: [{ questionId: 'unknown-question', choice: 0 }] },
        { id: 'practice-0', courseId: 'arduino', mode: 'generated', completedAt: '2026-11-14T00:00:00Z', answers: [{ questionId: quizQuestions.find(question => question.courseId === 'arduino').id, choice: 0 }] },
    ] }),
};
const reads = [];
const dashboard = readLearningDashboard({ getItem: key => { reads.push(key); return values[key] ?? null; } });
assert.equal(dashboard.courses.length, 5);
assert.equal(dashboard.total, 30);
assert.equal(dashboard.completed, 1);
assert.equal(dashboard.journals, 1);
assert.equal(dashboard.quizAttempts, 1);
assert.equal(dashboard.practiceAttempts, 2);
assert.equal(dashboard.resumeCourse.id, 'arduino');
assert.equal(dashboard.resumeCourse.nextLessonId, 'timing');
assert.equal(dashboard.recentQuiz.percentage, 67);
assert.equal(Object.hasOwn(dashboard.recentQuiz, 'secretExtra'), false);
assert.equal(JSON.stringify(dashboard).includes('private journal'), false);
assert.deepEqual(reads, ['strobot.original.course.v3', 'strobot.quiz.history.v1', 'strobot.review.evidence.v1']);
assert.throws(() => readLearningDashboard({ getItem: () => '{invalid' }));
const blank = readLearningDashboard({ getItem: () => null });
assert.equal(blank.completed, 0);
assert.equal(blank.resumeCourse, null);
console.log('PASS confirmed role views, protected student actions and current-account learning summaries');
