import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';
import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../shared/sdk/errors/domain.exception';
import { ErrorCode } from '../shared/sdk/errors/error-codes.enum';

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}
  async increment(key: string, ttl: number, limit: number, blockDuration: number) {
    // Lua is required for an atomic distributed increment + expiry + block decision.
    const script = `
      local block = redis.call('PTTL', KEYS[2])
      if block > 0 then return {0, 0, 1, block} end
      local hits = redis.call('INCR', KEYS[1])
      if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
      local remaining = redis.call('PTTL', KEYS[1])
      if hits > tonumber(ARGV[2]) then
        redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
        return {hits, remaining, 1, tonumber(ARGV[3])}
      end
      return {hits, remaining, 0, 0}
    `;
    try {
      const result = (await this.redis
        .getClient()
        .eval(
          script,
          2,
          'throttle:' + key,
          'throttle:' + key + ':block',
          ttl,
          limit,
          blockDuration || ttl,
        )) as number[];
      return {
        totalHits: result[0],
        timeToExpire: Math.ceil(result[1] / 1000),
        isBlocked: result[2] === 1,
        timeToBlockExpire: Math.ceil(result[3] / 1000),
      };
    } catch {
      throw new DomainException(
        'Rate limiting unavailable',
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
