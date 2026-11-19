import { courseLessons } from '../learner-state/learner-state.policy';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Management receives derived counts only, never journals, source code or raw values. */
export function studentProgressSummary(summary: unknown) {
  const stored = object(summary) && summary.source === 'learner-self-report' && Array.isArray(summary.courses)
    ? summary.courses.filter(object) : [];
  const courses = Object.entries(courseLessons).map(([courseId, lessons]) => {
    const item = stored.find(row => row.courseId === courseId);
    const completed = Number.isInteger(item?.completedLessons) &&
      Number(item?.completedLessons) >= 0 && Number(item?.completedLessons) <= lessons.length
      ? Number(item!.completedLessons) : 0;
    return { courseId, completed, total: lessons.length };
  });
  const completed = courses.reduce((sum, course) => sum + course.completed, 0);
  const total = courses.reduce((sum, course) => sum + course.total, 0);
  return { source: 'learner-self-report' as const, completed, total,
    percentage: total ? Math.round(100 * completed / total) : 0, courses };
}
