import { BaseDomainEvent } from '../../../shared/sdk/events/base.event';

export class UserRegisteredEvent extends BaseDomainEvent {
  constructor(userId: string, email: string) {
    super('user.registered', { userId, email }, userId);
  }
}

export class UserLoggedInEvent extends BaseDomainEvent {
  constructor(userId: string, ip?: string) {
    super('user.logged_in', { userId, ip }, userId);
  }
}

export class UserLoggedOutEvent extends BaseDomainEvent {
  constructor(userId: string) {
    super('user.logged_out', { userId }, userId);
  }
}
