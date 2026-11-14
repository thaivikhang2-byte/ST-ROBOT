require('../test/setup-env.cjs');
require('ts-node/register');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID, createHash } = require('node:crypto');
const express = require('express');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../src/app.module');
const { setupHttp } = require('../src/config/setup-http');
const { PrismaService } = require('../src/database/prisma.service');
const { AuthService } = require('../src/modules/auth/auth.service');
const { hashPassword } = require('../src/shared/utils/hash.util');
const { seed } = require('../prisma/seed');
(async () => {
  if (process.env.S3_BUCKET !== 'st-robot-phase6-test') throw new Error('Private isolated MinIO bucket required');
  const app = await NestFactory.create(AppModule, { logger: false });
  setupHttp(app);
  app.use('/src', express.static(path.resolve(__dirname, '../../frontend/src')));
  app.use(express.static(path.resolve(__dirname, '../../frontend/public')));
  await app.init();
  const prisma = app.get(PrismaService); await seed(prisma);
  async function user(roleName) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const password = randomUUID() + '-Browser-Test!';
    const record = await prisma.user.create({ data: { email: `${randomUUID()}@phase6-browser.example`, password_hash: await hashPassword(password),
      first_name: 'Media', last_name: 'Browser Test', is_email_verified: true, role_id: role.id } });
    return { ...record, password };
  }
  const teacher = await user('teacher'), student = await user('student');
  const course = await prisma.course.create({ data: { title: 'Phase 6 · Kiểm thử media riêng', slug: `phase6-browser-${randomUUID()}`, description: 'Database test riêng; không phải lịch sử học thật.', status: 'published', creator_id: teacher.id } });
  const lesson = await prisma.lesson.create({ data: { title: 'Tài nguyên robot · ảnh, MP4 và PDF', content: '<p>Video H.264/AAC dài 2 giây, ảnh PNG và PDF được phát qua MinIO private.</p>', course_id: course.id, status: 'published' } });
  await app.listen(0, '127.0.0.1'); const url = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const login = await app.get(AuthService).login({ email: teacher.email, password: teacher.password });
  const headers = { Authorization: `Bearer ${login.tokens.accessToken}`, 'Content-Type': 'application/json' };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
  const assets = [
    { name: 'robot-test.mp4', mime: 'video/mp4', bytes: await fs.readFile(path.resolve(__dirname, '../test/fixtures/lesson-test.mp4')) },
    { name: 'robot-test.png', mime: 'image/png', bytes: png },
    { name: 'lesson-test.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF') },
  ];
  for (const file of assets) {
    const start = await fetch(url + '/api/v1/media/uploads', { method: 'POST', headers, body: JSON.stringify({ lessonId: lesson.id, filename: file.name, mimeType: file.mime,
      sizeBytes: file.bytes.length, checksum: createHash('sha256').update(file.bytes).digest('hex') }) });
    if (start.status !== 201) throw new Error('Browser fixture initiation failed');
    const asset = (await start.json()).data;
    const put = await fetch(asset.upload.url, { method: 'PUT', headers: asset.upload.headers, body: file.bytes });
    if (put.status !== 200) throw new Error('Browser fixture PUT failed'); await put.arrayBuffer();
    const complete = await fetch(`${url}/api/v1/media/uploads/${asset.id}/complete`, { method: 'POST', headers, body: '{}' });
    if (complete.status !== 201) throw new Error('Browser fixture verification failed'); await complete.arrayBuffer();
  }
  await fs.writeFile(path.resolve(__dirname, '../.test-tmp/browser-phase6.json'), JSON.stringify({ url, email: student.email, password: student.password, userId: student.id, courseId: course.id, lessonId: lesson.id, teacherEmail: teacher.email, teacherPassword: teacher.password }));
  console.log('Isolated media browser-test server ready: ' + url);
  const close = () => { app.close().finally(() => process.exit()); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
})().catch(() => { console.error('Media browser test server startup failed'); process.exitCode = 1; });
