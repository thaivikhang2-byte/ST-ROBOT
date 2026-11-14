import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { setupHttp } from './config/setup-http';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from './shared/sdk/logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  const logger = await app.resolve(AppLoggerService);
  app.useLogger(logger);
  const settings = app.get(ConfigService);
  setupHttp(app);

  // ──────────────────────────────────────────────
  // Swagger / OpenAPI
  // ──────────────────────────────────────────────
  if (settings.get('app.nodeEnv') !== 'production' || settings.get('app.swaggerEnabled')) {
    const config = new DocumentBuilder()
      .setTitle('ST-Robot LMS API')
      .setDescription(
        'Identity, scoped RBAC, independent approvals, learning, AI and private adaptive HLS. See docs/phase10-video-streaming.md, docs/video-api.md and docs/secure-video-playback.md. Provider credentials are never returned.',
      )
      .setVersion('1.5')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          description: 'Dedicated read-only monitoring credential; LMS JWT is not accepted',
        },
        'metrics-scrape',
      )
      .addApiKey({ type: 'apiKey', in: 'query', name: 'token' }, 'video-playback')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          description: 'Enter JWT token',
          in: 'header',
        },
        'access-token',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
          description: 'API Key for service-to-service communication',
        },
        'api-key',
      )
      .addServer('/', 'Current deployment')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: false,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  // ──────────────────────────────────────────────
  // Graceful shutdown
  // ──────────────────────────────────────────────
  app.enableShutdownHooks();

  // ──────────────────────────────────────────────
  // Start server
  // ──────────────────────────────────────────────
  const port = settings.get<number>('app.port', 3000);
  await app.listen(port);

  logger.event('info', 'server.started', { port });
}

void bootstrap();
