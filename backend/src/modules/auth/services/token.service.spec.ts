import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { TokenService } from './token.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from '../dto/register.dto';
import { UpdateProfileDto } from '../dto/credential.dto';
import { envValidationSchema } from '../../../config/env.validation';

describe('Identity security primitives', () => {
  const config = new ConfigService({
    jwt: {
      secret: 'a'.repeat(48),
      refreshSecret: 'r'.repeat(48),
      expiration: '15m',
      refreshExpiration: '2h',
      issuer: 'test',
      audience: 'test',
    },
  });
  const jwt = new JwtService();
  const service = new TokenService(jwt, config);
  it.each(['none', 'issuer', 'audience'])('supports optional JWT metadata: %s', async (mode) => {
    const optionalConfig = new ConfigService({
      jwt: {
        secret: 'a'.repeat(48),
        refreshSecret: 'r'.repeat(48),
        ...(mode === 'issuer' ? { issuer: 'test' } : {}),
        ...(mode === 'audience' ? { audience: 'test' } : {}),
      },
    });
    const optionalService = new TokenService(jwt, optionalConfig);
    const claims = { sub: randomUUID(), sid: randomUUID(), ver: 0 };
    const pair = await optionalService.generateTokenPair(claims);
    expect(jwt.verify(pair.accessToken, { secret: 'a'.repeat(48) })).toMatchObject({
      ...claims,
      type: 'access',
    });
    await expect(optionalService.verifyRefreshToken(pair.refreshToken)).resolves.toMatchObject({
      ...claims,
      type: 'refresh',
    });
  });
  it('creates unique minimal token pairs and derives stored expiry from JWT', async () => {
    const claims = { sub: randomUUID(), sid: randomUUID(), ver: 0 };
    const a = await service.generateTokenPair(claims);
    const b = await service.generateTokenPair(claims);
    expect(a.refreshToken).not.toBe(b.refreshToken);
    expect(a.accessToken).not.toBe(b.accessToken);
    const payload = await service.verifyRefreshToken(a.refreshToken);
    expect(payload.exp - payload.iat).toBe(7200);
    expect(service.refreshExpiresAt(a).getTime()).toBe(payload.exp * 1000);
    expect(jwt.decode(a.accessToken)).not.toHaveProperty('roleName');
  });
  it.each(['access', 'invalid'])('rejects refresh token with type %s', async (type) => {
    const token = jwt.sign(
      { sub: randomUUID(), sid: randomUUID(), ver: 0, jti: randomUUID(), type },
      { secret: 'r'.repeat(48), expiresIn: '1h', issuer: 'test', audience: 'test' },
    );
    await expect(service.verifyRefreshToken(token)).rejects.toThrow();
  });
  it('rejects wrong algorithm, issuer and expired refresh tokens', async () => {
    const claims = {
      sub: randomUUID(),
      sid: randomUUID(),
      ver: 0,
      jti: randomUUID(),
      type: 'refresh',
    };
    for (const opts of [{ algorithm: 'HS384' as const }, { issuer: 'wrong' }, { expiresIn: -1 }]) {
      const token = jwt.sign(claims, {
        secret: 'r'.repeat(48),
        expiresIn: 60,
        issuer: 'test',
        audience: 'test',
        ...opts,
      });
      await expect(service.verifyRefreshToken(token)).rejects.toThrow();
    }
  });
  it('normalizes email and rejects weak/oversized Unicode passwords', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: ' USER@example.com ',
      password: 'long-password-123',
      firstName: 'A',
      lastName: 'B',
    });
    expect(dto.email).toBe('user@example.com');
    expect(await validate(dto)).toHaveLength(0);
    for (const password of ['short', '🔐'.repeat(25), 'valid-length\0password']) {
      dto.password = password;
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });
  it('rejects profile mass assignment', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      firstName: 'Good',
      role_id: randomUUID(),
      is_active: true,
      password_hash: 'bad',
    });
    expect((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length).toBe(3);
  });
  it('rejects weak or identical secrets and unsafe production mail config', () => {
    const base = {
      DATABASE_URL: 'postgresql://local/test',
      JWT_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'r'.repeat(48),
    };
    expect(envValidationSchema.validate(base).error).toBeUndefined();
    expect(envValidationSchema.validate({ ...base, JWT_SECRET: 'short' }).error).toBeDefined();
    expect(
      envValidationSchema.validate({ ...base, JWT_REFRESH_SECRET: base.JWT_SECRET }).error,
    ).toBeDefined();
    expect(
      envValidationSchema.validate({ ...base, NODE_ENV: 'production', MAIL_PROVIDER: 'file' })
        .error,
    ).toBeDefined();
  });
});
