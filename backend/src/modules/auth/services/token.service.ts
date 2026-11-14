import { Injectable } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { isUUID } from 'class-validator';
import { UnauthorizedException } from '../../../shared/sdk/errors/domain.exception';

export interface IdentityClaims {
  sub: string;
  sid: string;
  ver: number;
  type: 'access' | 'refresh';
  jti: string;
  exp: number;
  iat: number;
}
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}
export function validClaims(value: IdentityClaims, type: IdentityClaims['type']): boolean {
  return (
    !!value &&
    value.type === type &&
    isUUID(value.sub) &&
    isUUID(value.sid) &&
    isUUID(value.jti) &&
    Number.isInteger(value.ver) &&
    value.ver >= 0 &&
    Number.isInteger(value.exp) &&
    Number.isInteger(value.iat)
  );
}
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}
  async generateTokenPair(
    payload: Pick<IdentityClaims, 'sub' | 'sid' | 'ver'>,
  ): Promise<TokenPair> {
    const issuer = this.configService.get<string>('jwt.issuer');
    const audience = this.configService.get<string>('jwt.audience');
    const sign = (type: IdentityClaims['type'], secret: string, expiration: string) =>
      this.jwtService.signAsync(
        { ...payload, type, jti: randomUUID() },
        {
          algorithm: 'HS256',
          secret,
          expiresIn: expiration as JwtSignOptions['expiresIn'],
          ...(issuer ? { issuer } : {}),
          ...(audience ? { audience } : {}),
        },
      );
    const expiresIn = this.configService.get<string>('jwt.expiration', '15m');
    return {
      accessToken: await sign(
        'access',
        this.configService.getOrThrow<string>('jwt.secret'),
        expiresIn,
      ),
      refreshToken: await sign(
        'refresh',
        this.configService.getOrThrow<string>('jwt.refreshSecret'),
        this.configService.get<string>('jwt.refreshExpiration', '7d'),
      ),
      expiresIn,
    };
  }
  async verifyRefreshToken(token: string): Promise<IdentityClaims> {
    const payload = await this.jwtService.verifyAsync<IdentityClaims>(token, {
      algorithms: ['HS256'],
      secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
      issuer: this.configService.get<string>('jwt.issuer'),
      audience: this.configService.get<string>('jwt.audience'),
    });
    if (!validClaims(payload, 'refresh')) throw new UnauthorizedException('Invalid refresh token');
    return payload;
  }
  refreshExpiresAt(tokens: TokenPair): Date {
    // Decode only tokens just signed here, never untrusted tokens for authentication.
    return new Date(this.jwtService.decode<IdentityClaims>(tokens.refreshToken).exp * 1000);
  }
}
