import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import { AppModule } from '../src/app.module';
import { setupHttp } from '../src/config/setup-http';
async function exportDocument() {
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    setupHttp(app);
    await app.init();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ST-Robot Identity, Content, Learning, AI and Media API')
        .setVersion('1.5')
        .setDescription(
          'See PHASE3-SECURITY.md, phase9-implementation.md, phase10-video-streaming.md, video-api.md and secure-video-playback.md. Scoped permissions, independent approvals and private HLS capabilities are enforced server-side; provider credentials are never returned.',
        )
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token')
        .addBearerAuth(
          {
            type: 'http',
            scheme: 'bearer',
            description: 'Dedicated read-only monitoring credential; LMS JWT is not accepted',
          },
          'metrics-scrape',
        )
        .addApiKey({ type: 'apiKey', in: 'query', name: 'token' }, 'video-playback')
        .build(),
    );
    await writeFile(resolve('../docs/phase4-openapi.json'), JSON.stringify(document, null, 2));
    await writeFile(resolve('../docs/phase5-openapi.json'), JSON.stringify(document, null, 2));
    await writeFile(resolve('../docs/phase6-openapi.json'), JSON.stringify(document, null, 2));
    await writeFile(resolve('../docs/phase9-openapi.json'), JSON.stringify(document, null, 2));
    await writeFile(resolve('../docs/phase10-openapi.json'), JSON.stringify(document, null, 2));
    await writeFile(resolve('../docs/phase12-openapi.json'), JSON.stringify(document, null, 2));
    // Preserve existing documentation links as a compatibility alias of the current API.
    await writeFile(resolve('../docs/phase3-openapi.json'), JSON.stringify(document, null, 2));
    console.log('OpenAPI exported: ' + Object.keys(document.paths).length + ' paths');
  } finally {
    await app.close();
  }
}
void exportDocument();
