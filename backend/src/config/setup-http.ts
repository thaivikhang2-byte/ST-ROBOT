import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import type { Express, Request, Response, NextFunction } from 'express';
import { json } from 'express';
import type { ConfigType } from '@nestjs/config';
import { storageConfig, videoConfig } from './configurations';
import { MetricsService } from '../metrics/metrics.service';
import { AppLoggerService } from '../shared/sdk/logger/logger.service';
import { makeContext, withContext, currentContext } from '../shared/sdk/logger/request-context';
export function setupHttp(app: INestApplication): void {
  // Editor projects can be larger than ordinary API requests. Keep the larger
  // parser limited to the authenticated workspace route; other routes retain
  // Nest's ordinary body limit. The DTO/service applies a separate raw limit.
  const workspaceParser = json({ limit: '18mb' });
  // Nest detects existing middleware by its name. Registering `jsonParser`
  // directly here would disable Nest's parser on every other API route.
  app.use('/api/v1/learner-state', function workspaceJson(req: Request, res: Response, next: NextFunction) {
    workspaceParser(req, res, next);
  });
  const metrics = app.get(MetricsService);
  const settings = app.get(ConfigService);
  const logger = new AppLoggerService(settings.get('logging'));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const context = makeContext(req.get('X-Request-ID'), req.get('traceparent'));
    withContext(context, () => {
      const ids = currentContext()!;
      res.setHeader('X-Request-ID', ids.requestId);
      const start = performance.now();
      metrics.active.inc();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        metrics.active.dec();
        const route = (req.route as { path?: unknown } | undefined)?.path;
        const path = typeof route === 'string' ? route : 'unmatched';
        const status = res.writableFinished ? res.statusCode : 499;
        const duration = (performance.now() - start) / 1000;
        metrics.record(req.method, path, status, duration, ids.requestId, ids.traceId);
        if (status >= 400 || Math.random() < settings.get<number>('logging.httpSampleRate', 0.1))
          withContext(ids, () =>
            logger.event(
              status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
              'http.completed',
              { method: req.method, route: path, status, durationMs: Math.round(duration * 1000) },
            ),
          );
      };
      res.once('finish', finish);
      res.once('close', finish);
      next();
    });
  });
  app.use(
    [
      '/api/v1/admin',
      '/api/v1/teacher',
      '/api/v1/notifications',
      '/api/v1/users',
      '/api/v1/videos',
    ],
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control', 'private, no-store');
      next();
    },
  );
  const config = app.get(ConfigService);
  const storage = config.get<ConfigType<typeof storageConfig>>('storage');
  const mediaOrigins: string[] = [];
  const video = config.get<ConfigType<typeof videoConfig>>('video');
  if (video?.cloudEnabled && video.cloudCustomer)
    mediaOrigins.push(
      `https://customer-${video.cloudCustomer}.cloudflarestream.com`,
      'https://upload.videodelivery.net',
    );
  if (storage && storage.provider !== 'disabled') {
    try {
      const endpoint =
        storage.publicEndpoint || storage.endpoint || `https://s3.${storage.region}.amazonaws.com`;
      const url = new URL(endpoint);
      if (!url.username && !url.password && ['http:', 'https:'].includes(url.protocol)) {
        mediaOrigins.push(url.origin);
        if (!storage.forcePathStyle) {
          url.hostname = `${storage.bucket}.${url.hostname}`;
          mediaOrigins.push(url.origin);
        }
      }
    } catch {
      /* Unconfigured media stays unavailable; the LMS can still start. */
    }
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Local MinIO uses HTTP. Production retains Helmet's HTTPS upgrade policy.
          upgradeInsecureRequests: config.get<string>('app.nodeEnv') === 'production' ? [] : null,
          imgSrc: ["'self'", 'data:', ...mediaOrigins],
          mediaSrc: ["'self'", 'blob:', ...mediaOrigins],
          connectSrc: ["'self'", ...mediaOrigins],
        },
      },
    }),
  );
  const origins = config.get<string>('app.corsOrigin', '*');
  app.enableCors({
    origin: origins === '*' ? '*' : origins.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: false,
  });
  const trusted = config.get<string>('app.trustProxy', '');
  if (trusted) {
    const server = app.getHttpAdapter().getInstance() as Express;
    server.set(
      'trust proxy',
      trusted.split(',').map((s) => s.trim()),
    );
  }
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}
