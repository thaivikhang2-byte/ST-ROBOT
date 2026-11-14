import { BaseDomainEvent } from '../../../shared/sdk/events/base.event';

export class CourseCreatedEvent extends BaseDomainEvent {
  constructor(courseId: string, creatorId: string) {
    super('course.created', { courseId, creatorId }, creatorId);
  }
}

export class CoursePublishedEvent extends BaseDomainEvent {
  constructor(courseId: string, publisherId: string) {
    super('course.published', { courseId, publisherId }, publisherId);
  }
}

export class CourseDeletedEvent extends BaseDomainEvent {
  constructor(courseId: string, deletedBy: string) {
    super('course.deleted', { courseId, deletedBy }, deletedBy);
  }
}
