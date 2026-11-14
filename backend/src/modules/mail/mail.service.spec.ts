import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
describe('Credential delivery configuration', () => {
  it.each([
    { app: { nodeEnv: 'production' }, mail: { provider: 'file' } },
    { app: { nodeEnv: 'production' }, mail: { provider: 'smtp', host: '' } },
    { app: { nodeEnv: 'development' }, mail: { provider: 'smtp' } },
    { mail: { provider: 'file' } },
  ])('fails safely when delivery is unavailable or file transport is unsafe', (values) => {
    const mail = new MailService(new ConfigService(values));
    expect(() => mail.assertConfigured()).toThrow('Email delivery unavailable');
  });
  it('allows explicit development file delivery and configured production SMTP', () => {
    const dev = new MailService(
      new ConfigService({ app: { nodeEnv: 'development' }, mail: { provider: 'file' } }),
    );
    const prod = new MailService(
      new ConfigService({
        app: { nodeEnv: 'production' },
        mail: { provider: 'smtp', host: 'smtp.example.test' },
      }),
    );
    expect(() => dev.assertConfigured()).not.toThrow();
    expect(() => prod.assertConfigured()).not.toThrow();
  });
});
