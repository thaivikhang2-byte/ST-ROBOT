export interface RedisConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: { servername: string };
}

/** Accept a managed Redis URL without ever putting its credentials in errors. */
export function redisConnection(environment: Record<string, string | undefined>): RedisConnection {
  try {
    if (environment.REDIS_URL?.trim()) {
      const url = new URL(environment.REDIS_URL.trim());
      if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || url.search || url.hash)
        throw new Error();
      const port = url.port ? Number(url.port) : 6379;
      const database = url.pathname && url.pathname !== '/' ? url.pathname.slice(1) : '0';
      if (!/^\d{1,2}$/.test(database) || Number(database) > 15 || !Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error();
      return {
        host: url.hostname, port, db: Number(database),
        ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
        ...(url.protocol === 'rediss:' ? { tls: { servername: url.hostname } } : {}),
      };
    }
    const port = Number(environment.REDIS_PORT || '6379');
    const database = Number(environment.REDIS_DB || '0');
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(database) || database < 0 || database > 15)
      throw new Error();
    return {
      host: environment.REDIS_HOST || 'localhost', port, db: database,
      ...(environment.REDIS_USERNAME ? { username: environment.REDIS_USERNAME } : {}),
      ...(environment.REDIS_PASSWORD ? { password: environment.REDIS_PASSWORD } : {}),
    };
  } catch { throw new Error('Invalid Redis connection configuration'); }
}
