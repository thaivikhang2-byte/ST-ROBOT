import { redisConnection } from './redis-connection';

describe('Managed Redis connection configuration', () => {
  it('uses Render internal URLs for a private connection without a password', () => {
    expect(redisConnection({ REDIS_URL: 'redis://red-fixture:6379' })).toEqual({ host: 'red-fixture', port: 6379, db: 0 });
  });
  it('decodes credentials and enables verified TLS for rediss URLs', () => {
    expect(redisConnection({ REDIS_URL: 'rediss://default:fixture%40password@redis.school.example:6380/2' })).toEqual({
      host: 'redis.school.example', port: 6380, db: 2, username: 'default', password: 'fixture@password',
      tls: { servername: 'redis.school.example' },
    });
  });
  it('keeps local host/port/password configuration compatible', () => {
    expect(redisConnection({ REDIS_HOST: 'redis', REDIS_PORT: '6379', REDIS_PASSWORD: 'fixture', REDIS_DB: '1' }))
      .toEqual({ host: 'redis', port: 6379, db: 1, password: 'fixture' });
  });
  it.each(['https://redis.example', 'redis://redis.example/16', 'redis://redis.example/-1',
    'rediss://user:fixture-private@redis.example/?tls=false', 'redis://user:bad%value@redis.example'])
  ('fails closed and redacts malformed URLs: %s', value => {
    expect(() => redisConnection({ REDIS_URL: value })).toThrow('Invalid Redis connection configuration');
    try { redisConnection({ REDIS_URL: value }); } catch (error) {
      expect(String(error)).not.toContain(value);
      expect(String(error)).not.toContain('fixture-private');
    }
  });
});
