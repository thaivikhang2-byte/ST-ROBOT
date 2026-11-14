import { BaseDomainEvent } from '../../../shared/sdk/events/base.event';

export class QuizCompletedEvent extends BaseDomainEvent {
  constructor(quizId: string, userId: string, score: number, passed: boolean) {
    super('quiz.completed', { quizId, userId, score, passed }, userId);
  }
}
