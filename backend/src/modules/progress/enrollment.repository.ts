import type { Prisma } from '@prisma/client';
export function activateEnrollment(tx: Prisma.TransactionClient, userId: string, courseId: string) {
  return tx.enrollment.upsert({
    where: { user_id_course_id: { user_id: userId, course_id: courseId } },
    create: { user_id: userId, course_id: courseId, status: 'active' },
    update: { status: 'active', deleted_at: null },
  });
}
