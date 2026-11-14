// ═══════════════════════════════════════════
// Auth Module — Module Definition
// ═══════════════════════════════════════════

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './services/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CredentialService } from './services/credential.service';
import { MailService } from '../mail/mail.service';
import { BullModule } from '@nestjs/bull';
import { CredentialProcessor } from './services/credential.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'identity-mail' }),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          algorithm: 'HS256',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtStrategy,
    CredentialService,
    MailService,
    CredentialProcessor,
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
