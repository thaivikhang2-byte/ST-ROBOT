import { RedisThrottlerStorage } from './throttler.storage';
import { RedisService } from './redis.service';
describe('Redis throttling failure mode', () => {
  it('fails closed when Redis is unavailable', async () => {
    const redis = {
      getClient: () => ({ eval: () => Promise.reject(new Error('private connection details')) }),
    } as unknown as RedisService;
    await expect(
      new RedisThrottlerStorage(redis).increment('test', 60000, 5, 60000),
    ).rejects.toMatchObject({ message: 'Rate limiting unavailable' });
  });
});
