import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { DomainException } from '../../shared/sdk/errors/domain.exception';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';
import { HttpStatus } from '@nestjs/common';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  constructor(private readonly config: ConfigService) {}

  assertConfigured(): void {
    const file = this.config.get<string>('mail.provider') === 'file';
    if (
      (file && !['development', 'test'].includes(this.config.get<string>('app.nodeEnv', ''))) ||
      (!file && !this.config.get<string>('mail.host'))
    ) {
      throw new DomainException(
        'Email delivery unavailable',
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async sendCredential(
    email: string,
    purpose: 'reset' | 'verify',
    token: string,
  ): Promise<boolean> {
    this.assertConfigured();
    const subject = purpose === 'reset' ? 'ST-Robot: reset password' : 'ST-Robot: verify email';
    // No arbitrary URL from the request; tokens are delivered only to the account email.
    const text =
      subject +
      '\nSingle-use token: ' +
      token +
      '\nUse the ST-Robot account application. Never share this token.';
    try {
      if (this.config.get<string>('mail.provider') === 'file') {
        const directory = resolve(this.config.get<string>('mail.outbox', '.mail-outbox'));
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(
          resolve(directory, randomUUID() + '.json'),
          JSON.stringify({ to: email, subject, text }),
          { mode: 0o600, flag: 'wx' },
        );
      } else {
        const user = this.config.get<string>('mail.user');
        const transport = createTransport({
          host: this.config.getOrThrow<string>('mail.host'),
          port: this.config.get<number>('mail.port', 587),
          secure: this.config.get<boolean>('mail.secure', false),
          requireTLS: this.config.get<string>('app.nodeEnv') === 'production',
          auth: user ? { user, pass: this.config.get<string>('mail.password') } : undefined,
          connectionTimeout: 5000,
          socketTimeout: 10000,
        });
        await transport.sendMail({
          from: this.config.get<string>('mail.from'),
          to: email,
          subject,
          text,
        });
        transport.close();
      }
      return true;
    } catch {
      // Provider exceptions may embed recipient addresses, credentials and message contents.
      this.logger.error('Credential email delivery failed');
      return false;
    }
  }
}
