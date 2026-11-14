import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { EventBusService } from '../../shared/sdk/events/event-bus.service';
import {
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '../../shared/sdk/errors/domain.exception';
import { ApplicationException } from '../../shared/sdk/errors/application.exception';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokenService, TokenPair } from './services/token.service';
import { UserRegisteredEvent, UserLoggedInEvent, UserLoggedOutEvent } from './events/auth.events';
import { hashPassword, comparePassword, sha256 } from '../../shared/utils/hash.util';
import {
  assertActive,
  Identity,
  identityInclude,
  lockIdentity,
  profile,
  revokeIdentity,
} from './identity.repository';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../shared/sdk/auth/interfaces/request-user.interface';
import { UpdateProfileDto } from './dto/credential.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly eventBus: EventBusService,
    private readonly configService: ConfigService,
  ) {}

  private async issue(
    tx: Prisma.TransactionClient,
    user: Identity,
    familyId: string = randomUUID(),
    ip?: string,
    device?: string,
  ): Promise<TokenPair> {
    const tokens = await this.tokenService.generateTokenPair({
      sub: user.id,
      sid: familyId,
      ver: user.auth_version,
    });
    await tx.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash: sha256(tokens.refreshToken),
        family_id: familyId,
        expires_at: this.tokenService.refreshExpiresAt(tokens),
        ip_address: ip?.slice(0, 45),
        device_info: device?.slice(0, 500),
      },
    });
    return tokens;
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const found = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!found) {
      await hashPassword(dto.password); // Match bcrypt cost for nonexistent accounts.
      await AuditService.record(this.prisma, 'auth.login_failed');
      throw new UnauthorizedException('Invalid email or password');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await lockIdentity(tx, found.id);
      const valid = await comparePassword(dto.password, user.password_hash);
      if (!valid || !user.is_active || user.deleted_at || !profile(user).roles.length) {
        await AuditService.record(tx, 'auth.login_failed', user.id);
        return null;
      }
      const tokens = await this.issue(tx, user, randomUUID(), ip, userAgent);
      await tx.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } });
      await AuditService.record(tx, 'auth.login', user.id);
      return { user: profile(user), tokens };
    });
    if (!result) throw new UnauthorizedException('Invalid email or password');
    this.eventBus.emit(new UserLoggedInEvent(result.user.id, ip));
    return result;
  }

  async register(dto: RegisterDto) {
    if (!this.configService.get<boolean>('feature.registrationEnabled', true))
      throw new ForbiddenException('Registration is currently disabled');
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await hashPassword(dto.password);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const role = await tx.role.findUnique({ where: { name: 'student' } });
        if (!role?.is_default || !role.is_active)
          throw new ApplicationException('Default student role is not configured');
        const user = await tx.user.create({
          data: {
            email,
            password_hash: passwordHash,
            first_name: dto.firstName,
            last_name: dto.lastName,
            role_id: role.id,
            is_active: true,
            is_email_verified: false,
            rbac_migrated: true,
            role_assignments: { create: { role_id: role.id } },
          },
          include: identityInclude,
        });
        const tokens = await this.issue(tx, user);
        await AuditService.record(tx, 'auth.register', user.id);
        return { user: profile(user), tokens };
      });
      this.eventBus.emit(new UserRegisteredEvent(result.user.id, email));
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('An account with this email already exists');
      throw error;
    }
  }

  async refreshToken(dto: RefreshTokenDto) {
    const payload = await this.tokenService.verifyRefreshToken(dto.refreshToken).catch(() => {
      throw new UnauthorizedException('Invalid or expired refresh token');
    });
    const tokens = await this.prisma.$transaction(async (tx) => {
      const user = await lockIdentity(tx, payload.sub);
      assertActive(user);
      const stored = await tx.refreshToken.findUnique({
        where: { token_hash: sha256(dto.refreshToken) },
      });
      if (
        !stored ||
        stored.user_id !== user.id ||
        stored.family_id !== payload.sid ||
        payload.ver !== user.auth_version ||
        stored.expires_at <= new Date()
      )
        return null;
      if (stored.is_revoked) {
        await tx.refreshToken.updateMany({
          where: { user_id: user.id, family_id: stored.family_id },
          data: { is_revoked: true },
        });
        await AuditService.record(tx, 'auth.refresh_reuse', user.id, stored.family_id);
        return null; // Commit revocation before throwing outside the transaction.
      }
      const consumed = await tx.refreshToken.updateMany({
        where: { id: stored.id, is_revoked: false },
        data: { is_revoked: true },
      });
      if (consumed.count !== 1) return null;
      const next = await this.issue(
        tx,
        user,
        stored.family_id,
        stored.ip_address ?? undefined,
        stored.device_info ?? undefined,
      );
      await AuditService.record(tx, 'auth.refresh', user.id, stored.family_id);
      return next;
    });
    if (!tokens) throw new UnauthorizedException('Invalid or expired refresh token');
    return { tokens };
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockIdentity(tx, userId);
      await revokeIdentity(tx, userId);
      await AuditService.record(tx, 'auth.logout_all', userId);
    });
    this.eventBus.emit(new UserLoggedOutEvent(userId));
  }

  async sessions(user: RequestUser) {
    const rows = await this.prisma.refreshToken.findMany({
      where: { user_id: user.id, is_revoked: false, expires_at: { gt: new Date() } },
      orderBy: { created_at: 'desc' },
    });
    return Promise.all(
      rows.map(async (token) => {
        const first = await this.prisma.refreshToken.findFirst({
          where: { user_id: user.id, family_id: token.family_id },
          orderBy: { created_at: 'asc' },
          select: { created_at: true },
        });
        return {
          id: token.family_id,
          createdAt: first?.created_at,
          expiresAt: token.expires_at,
          lastActivityAt: token.created_at,
          deviceInfo: token.device_info,
          current: token.family_id === user.sessionId,
        };
      }),
    );
  }

  async revokeSession(user: RequestUser, sessionId: string, others = false): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockIdentity(tx, user.id);
      await tx.refreshToken.updateMany({
        where: { user_id: user.id, family_id: others ? { not: user.sessionId } : sessionId },
        data: { is_revoked: true },
      });
      await AuditService.record(
        tx,
        others ? 'auth.revoke_others' : 'auth.revoke_session',
        user.id,
        others ? undefined : sessionId,
      );
    });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: identityInclude,
    });
    if (!user) throw new UnauthorizedException();
    assertActive(user);
    return profile(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.$transaction(async (tx) => {
      assertActive(await lockIdentity(tx, userId));
      const user = await tx.user.update({
        where: { id: userId },
        data: { first_name: dto.firstName, last_name: dto.lastName, avatar_url: dto.avatarUrl },
        include: identityInclude,
      });
      return profile(user);
    });
  }
}
