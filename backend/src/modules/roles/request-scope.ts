import { isUUID } from 'class-validator';
import type { PrismaService } from '../../database/prisma.service';
// Only recognized server routes resolve a scope; a client ownerId never establishes ownership.
export async function requestCourse(
  prisma: PrismaService,
  request: {
    originalUrl?: string;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
  },
) {
  const params = request.params ?? {},
    path = request.originalUrl?.split('?')[0] ?? '';
  let courseId: string | undefined = params.courseId;
  let lessonId: string | undefined = params.lessonId;
  const id = params.id;
  if (id && isUUID(id)) {
    if (/\/courses\//.test(path)) courseId = id;
    else if (/\/lessons\//.test(path)) lessonId = id;
    else if (/\/quizzes\//.test(path))
      lessonId = (await prisma.quiz.findUnique({ where: { id }, select: { lesson_id: true } }))
        ?.lesson_id;
    else if (/\/(?:quiz-)?attempts\//.test(path))
      lessonId = (
        await prisma.quizAttempt.findUnique({
          where: { id },
          select: { quiz: { select: { lesson_id: true } } },
        })
      )?.quiz.lesson_id;
    else if (/\/videos\//.test(path))
      lessonId = (await prisma.video.findUnique({ where: { id }, select: { lesson_id: true } }))
        ?.lesson_id;
    else if (/\/media\//.test(path))
      lessonId = (
        await prisma.lessonMedia.findFirst({
          where: { storage_object_id: id },
          select: { lesson_id: true },
        })
      )?.lesson_id;
    else if (/\/practical-submissions\//.test(path))
      lessonId = (
        await prisma.practicalSubmission.findUnique({
          where: { id },
          select: { lab: { select: { lesson_id: true } } },
        })
      )?.lab.lesson_id;
    else if (/\/labs\//.test(path))
      lessonId = (
        await prisma.labResource.findUnique({ where: { id }, select: { lesson_id: true } })
      )?.lesson_id;
  }
  if (
    !courseId &&
    !lessonId &&
    (/\/(lessons|quizzes|uploads|videos|media)(\/|$)/.test(path) || /\/learning\/ai\//.test(path))
  ) {
    if (typeof request.body?.lessonId === 'string') lessonId = request.body.lessonId;
    if (typeof request.body?.courseId === 'string') courseId = request.body.courseId;
    if (typeof request.query?.lessonId === 'string') lessonId = request.query.lessonId;
    if (typeof request.query?.courseId === 'string') courseId = request.query.courseId;
  }
  if (lessonId && isUUID(lessonId))
    courseId = (
      await prisma.lesson.findFirst({
        where: { id: lessonId, deleted_at: null },
        select: { course_id: true },
      })
    )?.course_id;
  if (!courseId || !isUUID(courseId)) return undefined;
  return (
    await prisma.course.findFirst({
      where: { id: courseId, deleted_at: null },
      select: { id: true },
    })
  )?.id;
}
