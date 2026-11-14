// Operator-only smoke test: sends exactly two real credential emails to the supplied mailbox.
// Run inside the backend container. Tokens/passwords stay in process memory and are never printed.
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const load = (name) => require(require.resolve(name, { paths: [process.cwd()] }));

async function main() {
  assert(existsSync('/.dockerenv'), 'Run inside the Docker backend');
  assert.equal(process.env.PHASE3_SMOKE_ALLOW_SEND, 'true', 'Explicit mail-send opt-in required');
  const email = (process.env.PHASE3_SMOKE_EMAIL || '').trim().toLowerCase();
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'A controlled test mailbox is required');
  const { NestFactory } = load('@nestjs/core');
  const { ConfigService } = load('@nestjs/config');
  const { AppModule } = load(process.cwd() + '/dist/app.module.js');
  const { MailService } = load(process.cwd() + '/dist/modules/mail/mail.service.js');
  const { CredentialService } = load(process.cwd() + '/dist/modules/auth/services/credential.service.js');
  const { PrismaService } = load(process.cwd() + '/dist/database/prisma.service.js');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const config = app.get(ConfigService);
    const smtp = load('nodemailer').createTransport({
      host: config.getOrThrow('mail.host'),
      port: config.get('mail.port', 587),
      secure: config.get('mail.secure', false),
      requireTLS: true,
      auth: { user: config.getOrThrow('mail.user'), pass: config.getOrThrow('mail.password') },
      connectionTimeout: 5000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
    try {
      await smtp.verify();
      console.log('PASS SMTP TLS/authentication');
    } finally {
      smtp.close();
    }
    const prisma = app.get(PrismaService);
    assert.equal(await prisma.user.count({ where: { email } }), 0, 'Refusing to modify an existing account');
    const base = 'http://nginx/api/v1/auth/';
    async function api(path, body, status, token) {
      const response = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status !== status) {
        console.error('HTTP status mismatch:', path, 'expected', status, 'received', response.status);
      }
      assert.equal(response.status, status, 'Unexpected HTTP status: ' + path);
      return response.json();
    }
    const password = randomBytes(24).toString('hex') + 'A!';
    const account = (await api('register', { email, password, firstName: 'Phase3', lastName: 'SMTP Smoke' }, 201)).data;
    assert(!JSON.stringify(account).includes('password_hash'));
    assert.equal(account.user.role.name, 'student');
    console.log('PASS registration via Nginx');
    const mail = app.get(MailService);
    const send = mail.sendCredential.bind(mail);
    const captured = new Map();
    mail.sendCredential = async (recipient, purpose, token) => {
      assert.equal(recipient, email);
      const delivered = await send(recipient, purpose, token);
      assert.equal(delivered, true, 'SMTP did not accept credential email');
      captured.set(purpose, token);
      return delivered;
    };
    const credentials = app.get(CredentialService);
    await credentials.deliver(email, 'verify');
    assert(captured.has('verify'));
    await api('verify-email', { token: captured.get('verify') }, 200);
    await api('verify-email', { token: captured.get('verify') }, 400);
    const profile = (await api('me', undefined, 200, account.tokens.accessToken)).data;
    assert.equal(profile.isEmailVerified, true);
    console.log('PASS real verification email accepted by SMTP; HTTP consumption/replay protection');
    await credentials.deliver(email, 'reset');
    assert(captured.has('reset'));
    const nextPassword = randomBytes(24).toString('hex') + 'B!';
    await api('reset-password', { token: captured.get('reset'), newPassword: nextPassword }, 200);
    await api('reset-password', { token: captured.get('reset'), newPassword: nextPassword }, 400);
    await api('me', undefined, 401, account.tokens.accessToken);
    await api('login', { email, password }, 401);
    const login = (await api('login', { email, password: nextPassword }, 200)).data;
    await api('logout-all', {}, 200, login.tokens.accessToken);
    await api('me', undefined, 401, login.tokens.accessToken);
    captured.clear();
    console.log('PASS real reset email accepted by SMTP; reset/login/revocation via Nginx');
    console.log('PASS smoke complete; student test account retained, no active sessions; inbox receipt not asserted');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  // SMTP errors can contain credentials, addresses or server responses: emit only a safe code.
  const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'SMOKE_FAILED';
  console.error('FAIL Docker identity smoke:', code);
  process.exitCode = 1;
});
