import { BaseDomainEvent } from '../../../shared/sdk/events/base.event';

export class LessonCompletedEvent extends BaseDomainEvent {
  constructor(lessonId: string, userId: string, courseId: string) {
    super('lesson.completed', { lessonId, userId, courseId }, userId);
  }
}
