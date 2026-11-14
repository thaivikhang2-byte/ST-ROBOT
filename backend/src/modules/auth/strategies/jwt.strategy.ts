import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { RequestUser } from '../../../shared/sdk/auth/interfaces/request-user.interface';
import { UnauthorizedException } from '../../../shared/sdk/errors/domain.exception';
import { IdentityClaims, validClaims } from '../services/token.service';
import { identityInclude } from '../identity.repository';
import { grantPermissions, resolveGrants } from '../../roles/authorization';
export type JwtPayload = IdentityClaims;
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.secret'),
      algorithms: ['HS256'],
      issuer: config.get<string>('jwt.issuer'),
      audience: config.get<string>('jwt.audience'),
    });
  }
  async validate(payload: IdentityClaims): Promise<RequestUser> {
    if (!validClaims(payload, 'access')) throw new UnauthorizedException('Invalid access token');
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        ...identityInclude,
        refresh_tokens: {
          where: { family_id: payload.sid, is_revoked: false, expires_at: { gt: new Date() } },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (
      !user ||
      !user.is_active ||
      user.deleted_at ||
      user.auth_version !== payload.ver ||
      !user.refresh_tokens.length
    ) {
      throw new UnauthorizedException('Session is no longer active');
    }
    const grants = resolveGrants(user);
    if (!grants.length) throw new UnauthorizedException('No active role assignment');
    return {
      id: user.id,
      email: user.email,
      roleId: user.role.id,
      roleName: user.role.name,
      permissions: grantPermissions(grants, undefined, user.id),
      grants,
      isActive: user.is_active,
      isEmailVerified: user.is_email_verified,
      sessionId: payload.sid,
    };
  }
}
