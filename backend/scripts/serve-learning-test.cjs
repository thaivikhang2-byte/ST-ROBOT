require('../test/setup-env.cjs'); // Refuse every database except the named disposable test services.
require('ts-node/register');
const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('express');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../src/app.module');
const { setupHttp } = require('../src/config/setup-http');
const { PrismaService } = require('../src/database/prisma.service');
const { hashPassword } = require('../src/shared/utils/hash.util');
const { seed } = require('../prisma/seed');
const { importLearning } = require('../prisma/import-learning');
const { authoredId } = require('../src/modules/progress/authored-id');

(async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  setupHttp(app);
  app.use('/src', express.static(path.resolve(__dirname, '../../frontend/src')));
  app.use(express.static(path.resolve(__dirname, '../../frontend/public')));
  await app.init();
  const prisma = app.get(PrismaService);
  await seed(prisma);
  const teacherRole = await prisma.role.findUniqueOrThrow({ where: { name: 'teacher' } });
  let owner = await prisma.course.findUnique({ where: { id: authoredId('course:arduino') } });
  if (!owner) {
    const teacher = await prisma.user.create({ data: { email: `${randomUUID()}@browser-phase5.example`, password_hash: await hashPassword(randomUUID()), first_name: 'Browser', last_name: 'Teacher', role_id: teacherRole.id, is_email_verified: true } });
    await importLearning(prisma, teacher.id);
    owner = await prisma.course.findUniqueOrThrow({ where: { id: authoredId('course:arduino') } });
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'student' } });
  const email = `${randomUUID()}@browser-phase5.example`;
  const password = randomUUID() + '-browser-test!';
  const student = await prisma.user.create({ data: { email, password_hash: await hashPassword(password), first_name: 'Browser', last_name: 'Student', role_id: role.id, is_email_verified: true } });
  await app.listen(0, '127.0.0.1');
  const port = app.getHttpServer().address().port;
  const url = `http://127.0.0.1:${port}`;
  await fs.writeFile(path.resolve(__dirname, '../.test-tmp/browser-phase5.json'), JSON.stringify({ url, email, password, userId: student.id }));
  console.log('Isolated browser-test server ready: ' + url);
  const close = () => { app.close().finally(() => process.exit()); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
})().catch(() => { console.error('Isolated browser test startup failed'); process.exitCode = 1; });
