// ═══════════════════════════════════════════
// Redis — Redis Module
// ═══════════════════════════════════════════

import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { CACHE_STORE } from '../shared/sdk/cache/cache.service';

@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: CACHE_STORE,
      useExisting: RedisService,
    },
  ],
  exports: [RedisService, CACHE_STORE],
})
export class RedisModule {}
