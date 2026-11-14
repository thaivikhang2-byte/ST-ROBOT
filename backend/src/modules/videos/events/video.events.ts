import { BaseDomainEvent } from '../../../shared/sdk/events/base.event';

export class VideoStartedEvent extends BaseDomainEvent {
  constructor(videoId: string, userId: string, sessionId: string) {
    super('video.started', { videoId, userId, sessionId }, userId);
  }
}

export class VideoFinishedEvent extends BaseDomainEvent {
  constructor(videoId: string, userId: string, sessionId: string, watchDuration: number) {
    super('video.finished', { videoId, userId, sessionId, watchDuration }, userId);
  }
}
