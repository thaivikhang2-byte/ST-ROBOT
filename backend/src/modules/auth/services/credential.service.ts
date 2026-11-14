import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../database/prisma.service';
import { MailService } from '../../mail/mail.service';
import { AuditService } from '../../audit/audit.service';
import {
  comparePassword,
  hashPassword,
  generateToken,
  sha256,
} from '../../../shared/utils/hash.util';
import {
  DomainException,
  UnauthorizedException,
} from '../../../shared/sdk/errors/domain.exception';
import { ErrorCode } from '../../../shared/sdk/errors/error-codes.enum';
import { assertActive, lockIdentity, revokeIdentity } from '../identity.repository';
import { ChangePasswordDto, ResetPasswordDto } from '../dto/credential.dto';
import { queuedContext } from '../../../shared/sdk/logger/request-context';

@Injectable()
export class CredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @InjectQueue('identity-mail') private readonly mailQueue: Queue,
  ) {}

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      const user = await lockIdentity(tx, userId);
      assertActive(user);
      if (!(await comparePassword(dto.currentPassword, user.password_hash)))
        throw new UnauthorizedException('Invalid current password');
      if (await comparePassword(dto.newPassword, user.password_hash))
        throw new DomainException('New password must differ', ErrorCode.VALIDATION_ERROR);
      await tx.user.update({ where: { id: userId }, data: { password_hash: passwordHash } });
      await revokeIdentity(tx, userId);
      await tx.credentialToken.updateMany({
        where: { user_id: userId, consumed_at: null },
        data: { consumed_at: new Date() },
      });
      await AuditService.record(tx, 'auth.password_changed', userId);
    });
  }

  async request(email: string, purpose: 'reset' | 'verify'): Promise<void> {
    this.mail.assertConfigured();
    try {
      // Every address takes the same queue path. No account lookup or SMTP timing at the API.
      // Generate raw tokens in the worker, never put authentication secrets into Redis jobs.
      await this.mailQueue.add(
        'deliver',
        { email: email.trim().toLowerCase(), purpose, ...queuedContext() },
        {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch {
      throw new DomainException(
        'Email delivery unavailable',
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async deliver(email: string, purpose: 'reset' | 'verify'): Promise<void> {
    this.mail.assertConfigured();
    const found = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!found) return;
    const token = generateToken(32);
    const record = await this.prisma.$transaction(async (tx) => {
      const user = await lockIdentity(tx, found.id);
      if (
        !user.is_active ||
        user.deleted_at ||
        !user.role.is_active ||
        (purpose === 'verify' && user.is_email_verified)
      )
        return null;
      // Per-account limit also applies across IP addresses, without an enumeration response.
      const recent = await tx.credentialToken.findFirst({
        where: { user_id: user.id, purpose, created_at: { gt: new Date(Date.now() - 60000) } },
      });
      if (recent) return null;
      await tx.credentialToken.updateMany({
        where: { user_id: user.id, purpose, consumed_at: null },
        data: { consumed_at: new Date() },
      });
      const created = await tx.credentialToken.create({
        data: {
          user_id: user.id,
          email: user.email,
          purpose,
          token_hash: sha256(token),
          expires_at: new Date(Date.now() + (purpose === 'reset' ? 30 * 60000 : 24 * 3600000)),
        },
      });
      await AuditService.record(tx, 'auth.' + purpose + '_requested', user.id);
      return created;
    });
    if (!record) return;
    const delivered = await this.mail.sendCredential(record.email, purpose, token);
    if (!delivered) {
      await this.prisma.credentialToken.update({
        where: { id: record.id },
        data: { consumed_at: new Date() },
      });
      await AuditService.record(this.prisma, 'auth.delivery_failed', record.user_id);
    }
    // Always generic even if SMTP fails; token is unusable on failed delivery.
  }

  async consume(token: string, purpose: 'reset' | 'verify', dto?: ResetPasswordDto): Promise<void> {
    const found = await this.prisma.credentialToken.findUnique({
      where: { token_hash: sha256(token) },
    });
    if (!found || found.purpose !== purpose)
      throw new DomainException('Invalid or expired token', ErrorCode.TOKEN_INVALID);
    const passwordHash = dto ? await hashPassword(dto.newPassword) : undefined;
    await this.prisma.$transaction(async (tx) => {
      const user = await lockIdentity(tx, found.user_id);
      assertActive(user);
      if (found.email !== user.email)
        throw new DomainException('Invalid or expired token', ErrorCode.TOKEN_INVALID);
      const consumed = await tx.credentialToken.updateMany({
        where: { id: found.id, purpose, consumed_at: null, expires_at: { gt: new Date() } },
        data: { consumed_at: new Date() },
      });
      if (consumed.count !== 1)
        throw new DomainException('Invalid or expired token', ErrorCode.TOKEN_INVALID);
      if (purpose === 'reset' && passwordHash) {
        await tx.user.update({ where: { id: user.id }, data: { password_hash: passwordHash } });
        await revokeIdentity(tx, user.id);
        await tx.credentialToken.updateMany({
          where: { user_id: user.id, purpose: 'reset', consumed_at: null },
          data: { consumed_at: new Date() },
        });
      } else if (purpose === 'verify') {
        await tx.user.update({ where: { id: user.id }, data: { is_email_verified: true } });
      }
      await AuditService.record(
        tx,
        purpose === 'reset' ? 'auth.password_reset' : 'auth.email_verified',
        user.id,
      );
    });
  }

  @Cron('0 3 * * *')
  async cleanupExpired(): Promise<void> {
    // Retain refresh ancestors until *all* family tokens expire so reuse remains detectable.
    const expired = await this.prisma.refreshToken.groupBy({
      by: ['family_id'],
      _max: { expires_at: true },
      having: { expires_at: { _max: { lt: new Date() } } },
      take: 500,
      orderBy: { family_id: 'asc' },
    });
    if (expired.length)
      await this.prisma.refreshToken.deleteMany({
        where: {
          family_id: { in: expired.map((t) => t.family_id) },
          expires_at: { lt: new Date() },
        },
      });
    await this.prisma.credentialToken.deleteMany({ where: { expires_at: { lt: new Date() } } });
  }
}
