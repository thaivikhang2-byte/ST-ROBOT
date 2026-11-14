// Isolated real Nest/PostgreSQL schema. Only the external gateway is deterministic test data.
require('../test/setup-env.cjs');
const { spawnSync } = require('node:child_process'), { randomUUID } = require('node:crypto');
const schema = 'phase13_browser_' + Date.now(), url = new URL(process.env.DATABASE_URL);
url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.href;
const migrated = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
if (migrated.status !== 0) throw new Error('Disposable browser schema migration failed; credentials withheld');
require('ts-node/register');
const fs = require('node:fs/promises'), path = require('node:path'), express = require('express');
const { Test } = require('@nestjs/testing');
const { ServiceUnavailableException } = require('@nestjs/common');
const { AppModule } = require('../src/app.module'), { setupHttp } = require('../src/config/setup-http');
const { AiGatewayService } = require('../src/modules/ai-gateway/ai-gateway.service');
const { AiAgentService } = require('../src/modules/ai-gateway/agent/ai-agent.service');
const { AgentToolRegistry } = require('../src/modules/ai-gateway/agent/agent-tool-registry');
const { PrismaService } = require('../src/database/prisma.service');
const { AuthService } = require('../src/modules/auth/auth.service');
const { ProgressService } = require('../src/modules/progress/progress.service');
const { hashPassword } = require('../src/shared/utils/hash.util');
const { seed } = require('../prisma/seed');
(async () => {
  const draftTitle = 'QA Phase13 confirmed draft ' + randomUUID();
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AiGatewayService).useValue({
    chat: async (_actor, dto, signal) => {
      const question = dto.messages.filter(row => row.role === 'user').at(-1)?.content || '';
      if (question.includes('simulate-error')) throw new ServiceUnavailableException('QA provider unavailable');
      if (question.includes('simulate-slow')) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 10000); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, { once: true });
      });
      if (dto.messages.at(-1).role === 'tool') return { text: 'QA grounded response after authorized tool.', toolCalls: [] };
      const tool = question.includes('remember-preference')
        ? { name: 'memory_propose', arguments: { content: 'I prefer short robotics examples.', reason: 'Personal learning preference.' } }
        : question.includes('create-draft') ? { name: 'management_propose_course_draft', arguments: { title: draftTitle, description: 'QA review-only draft.' } }
        : { name: 'learning_search_courses', arguments: { query: 'Phase13' } };
      return { text: '', toolCalls: [{ id: 'qa-call-' + randomUUID(), ...tool }] };
    }
  }).compile();
  const app = module.createNestApplication(); setupHttp(app);
  app.use('/src', express.static(path.resolve(__dirname, '../../frontend/src')));
  app.use(express.static(path.resolve(__dirname, '../../frontend/public')));
  await app.init(); const db = app.get(PrismaService); await seed(db);
  await db.aiProvider.update({ where: { id: 'openai' }, data: { enabled: true } });
  await db.aiModel.create({ data: { provider_id: 'openai', model_id: 'deterministic-browser-only', enabled: true, is_default: true,
    capabilities: ['chat', 'tools'], max_input_tokens: 16000, max_output_tokens: 2000, context_tokens: 18000,
    allowed_tools: app.get(AgentToolRegistry).all().map(tool => tool.name) } });
  async function account(name) {
    const role = await db.role.findUniqueOrThrow({ where: { name } }), password = randomUUID() + '-QA!13';
    const user = await db.user.create({ data: { email: randomUUID() + '@phase13-browser.test', first_name: 'QA', last_name: name,
      password_hash: await hashPassword(password), role_id: role.id, is_email_verified: true } });
    const login = await app.get(AuthService).login({ email: user.email, password });
    const refresh = await db.refreshToken.findFirstOrThrow({ where: { user_id: user.id, is_revoked: false } });
    return { id: user.id, email: user.email, password, actor: { id: user.id, email: user.email, roleId: role.id, roleName: name,
      permissions: login.user.permissions, grants: login.user.roles, isActive: true, isEmailVerified: true, sessionId: refresh.family_id } };
  }
  const root = await account('superadmin'), teacher = await account('teacher'), student = await account('student');
  const course = await db.course.create({ data: { title: 'QA Phase13 robotics', slug: randomUUID(), creator_id: teacher.id, status: 'published' } });
  const lesson = await db.lesson.create({ data: { course_id: course.id, title: 'QA Phase13 sensor lesson', content: '<p>Measure sensor distance in centimeters.</p>', status: 'published' } });
  await app.get(ProgressService).enroll(student.actor, course.id);
  await app.get(AiAgentService).setActionControl(root.actor, true);
  await app.listen(0, '127.0.0.1');
  const fixture = { url: `http://127.0.0.1:${app.getHttpServer().address().port}`, databaseUrl: url.href, schema,
    courseId: course.id, lessonId: lesson.id, draftTitle, root, teacher, student };
  await fs.writeFile(path.resolve(__dirname, '../.test-tmp/browser-phase13.json'), JSON.stringify(fixture));
  console.log('Disposable Phase13 browser server: ' + fixture.url + ' (mocked external gateway; real tools/DB)');
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => app.close().finally(() => process.exit()));
})().catch(error => { console.error('Phase13 fixture failed:', error.code || error.name, '(credentials withheld)'); process.exit(1); });
