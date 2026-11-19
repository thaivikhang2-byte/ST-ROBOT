import { quizCourses } from '../../data/quiz.js?v=guided-learning-v15';
import { QuizService } from '../quiz/QuizService.js?v=account-sync-v1';
import { ReviewService, MAX_REVIEW_ATTEMPTS } from '../quiz/ReviewService.js?v=account-sync-v1';

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const quizValidator = new QuizService({ storage: null });
const reviewValidator = new ReviewService({ storage: null });
const parse = (storage, key, fallback) => {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
};

export function workspaceAccess(user, { offline = false } = {}) {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    const permissions = new Set(Array.isArray(user?.permissions) ? user.permissions : []);
    const manager = roles.some(role => role.group === 'MANAGER' && role.scopeType === 'SYSTEM');
    const teacher = roles.some(role => role.group === 'TEACHER' || (role.group === 'MANAGER' && role.scopeType === 'COURSE'));
    const confirmed = Boolean(user?.isEmailVerified && !offline);
    return {
        label: offline ? 'Phiên ngoại tuyến' : manager ? 'Quản trị hệ thống' : teacher ? 'Giảng viên' : 'Học sinh',
        manager,
        management: confirmed && (teacher || (manager && ['dashboard:read', 'users:read', 'audit:read', 'analytics:read', 'ai:manage'].some(value => permissions.has(value)))),
        canUpdateStudents: confirmed && manager && permissions.has('users:update'),
    };
}

export function canUpdateStudentStatus(actor, student, options = {}) {
    if (!workspaceAccess(actor, options).canUpdateStudents || !student?.id || actor.id === student.id || student.approvalPending) return false;
    if (['admin', 'superadmin', 'teacher'].includes(student.role?.name)) return false;
    if (student.management !== undefined) return student.management?.studentOnly === true
        && Array.isArray(student.management.roleGroups) && student.management.roleGroups.length > 0
        && student.management.roleGroups.every(group => group === 'STUDENT');
    if (student.isActive === false) return false;
    return Array.isArray(student.roles) && student.roles.length > 0 && student.roles.every(role => role.group === 'STUDENT');
}

export function canApproveStudent(actor, student, options = {}) {
    const access = workspaceAccess(actor, options);
    return Boolean(access.manager && access.management && actor?.permissions?.includes('users:create')
        && student?.id && student.approvalPending === true && student.isActive === false
        && actor.id !== student.id && student.management?.studentOnly === true
        && Array.isArray(student.management.roleGroups) && student.management.roleGroups.length > 0
        && student.management.roleGroups.every(group => group === 'STUDENT'));
}

/** Read only the current account's storage facade; never read the guest keys here. */
export function readLearningDashboard(storage) {
    const state = parse(storage, 'strobot.original.course.v3', {});
    const history = parse(storage, 'strobot.quiz.history.v1', []);
    const review = parse(storage, 'strobot.review.evidence.v1', { attempts: [] });
    if (!record(state) || !Array.isArray(history) || !record(review) || !Array.isArray(review.attempts))
        throw new Error('Bản lưu học tập chưa đọc được. Hãy giữ bản sao trên thiết bị trước khi đồng bộ lại.');
    const known = new Map(quizCourses.map(course => [course.id, course]));
    const quizzes = history.filter(row => quizValidator.validResult(row))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 20);
    const reviewedIds = new Set();
    const completedAttempts = review.attempts.filter(row => {
        if (!reviewValidator.validAttempt(row) || reviewedIds.has(row.id)) return false;
        reviewedIds.add(row.id); return true;
    }).slice(-MAX_REVIEW_ATTEMPTS);
    const practice = completedAttempts.filter(row => ['review', 'generated'].includes(row.mode));
    const courses = quizCourses.map(course => {
        const values = record(state[course.id]) ? state[course.id] : {};
        const saved = course.lessons.filter(lesson => record(values[lesson.id]));
        const completed = course.lessons.filter(lesson => values[lesson.id]?.done === true);
        const next = course.lessons.find(lesson => values[lesson.id]?.done !== true) || course.lessons[0];
        return {
            id: course.id,
            name: course.name,
            total: course.lessons.length,
            saved: saved.length,
            completed: completed.length,
            journals: saved.filter(lesson => typeof values[lesson.id].note === 'string' && values[lesson.id].note.trim()).length,
            quizAttempts: quizzes.filter(item => item.courseId === course.id).length,
            practiceAttempts: practice.filter(item => item.courseId === course.id).length,
            nextLessonId: next.id,
            nextLessonTitle: next.title,
        };
    });
    return {
        courses,
        completed: courses.reduce((total, course) => total + course.completed, 0),
        total: courses.reduce((total, course) => total + course.total, 0),
        journals: courses.reduce((total, course) => total + course.journals, 0),
        quizAttempts: quizzes.length,
        practiceAttempts: practice.length,
        recentQuiz: quizzes[0] ? { courseId: quizzes[0].courseId, correct: quizzes[0].correct, total: quizzes[0].total,
            percentage: quizzes[0].percentage, createdAt: quizzes[0].createdAt, courseName: known.get(quizzes[0].courseId).name } : null,
        resumeCourse: courses.find(course => course.id === state.last) || courses.find(course => course.saved > 0) || null,
    };
}
