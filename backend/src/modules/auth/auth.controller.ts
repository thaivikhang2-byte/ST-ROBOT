import { ApiExtraModels, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import {
  TokenPairResponseDto,
  ProfileResponseDto,
  SessionResponseDto,
  authSchema,
  tokensSchema,
  profileSchema,
  sessionsSchema,
  messageSchema,
} from './dto/auth-response.dto';
import {
  Controller,
  Post,
  Body,
  HttpCode,
  Get,
  Req,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  Header,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { CredentialService } from './services/credential.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  ChangePasswordDto,
  ResetPasswordDto,
  CredentialTokenDto,
  EmailDto,
  UpdateProfileDto,
} from './dto/credential.dto';
import { Public, CurrentUser } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';

const minute = 60000;
const genericEmailMessage = { message: 'If the account is eligible, an email will be sent.' };

@ApiExtraModels(TokenPairResponseDto, ProfileResponseDto, SessionResponseDto)
@ApiOkResponse({ schema: messageSchema })
@ApiTags('Auth')
@ApiBearerAuth('access-token')
@ApiResponse({
  status: 400,
  description: 'DTO validation failed or one-time token invalid/expired/consumed',
})
@ApiResponse({ status: 401, description: 'Invalid credentials, JWT or revoked session' })
@ApiResponse({
  status: 429,
  description: 'Rate limit exceeded; retry after the indicated interval',
})
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: CredentialService,
  ) {}

  @Public()
  @ApiOperation({ security: [] })
  @ApiOkResponse({ schema: authSchema })
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: minute } })
  @ApiOperation({ summary: 'Login; JSON tokens, unverified accounts retain student access' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req.ip, req.headers['user-agent']);
  }

  @Public()
  @ApiOperation({ security: [] })
  @ApiCreatedResponse({ schema: authSchema })
  @Post('register')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 3, ttl: minute } })
  @ApiOperation({
    summary: 'Register as student; immediate JSON tokens; request email verification separately',
  })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @ApiOperation({ security: [] })
  @ApiOkResponse({ schema: tokensSchema })
  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: minute } })
  @ApiOperation({ summary: 'Rotate refresh token once; reuse revokes the entire session family' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refreshToken(dto);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Legacy logout: revoke ALL sessions and access tokens' })
  async logout(@CurrentUser() user: RequestUser) {
    await this.auth.logout(user.id);
    return { message: 'Logged out successfully' };
  }

  @Post('logout-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke all sessions and access tokens' })
  logoutAll(@CurrentUser() user: RequestUser) {
    return this.logout(user);
  }

  @Post('logout-current')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke only the session identified by the access token' })
  async logoutCurrent(@CurrentUser() user: RequestUser) {
    await this.auth.revokeSession(user, user.sessionId);
    return { message: 'Session revoked' };
  }

  @ApiOkResponse({ schema: sessionsSchema })
  @Get('sessions')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List active sessions; lastActivityAt tracks login/refresh, not every request',
  })
  sessions(@CurrentUser() user: RequestUser) {
    return this.auth.sessions(user);
  }

  @Post('logout-others')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke every session except the current session' })
  async logoutOthers(@CurrentUser() user: RequestUser) {
    await this.auth.revokeSession(user, user.sessionId, true);
    return { message: 'Other sessions revoked' };
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Revoke an owned session by family UUID; idempotent' })
  async revoke(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(user, id);
    return { message: 'Session revoked' };
  }

  @ApiOkResponse({ schema: profileSchema })
  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Current profile and authoritative permissions' })
  profile(@CurrentUser() user: RequestUser) {
    return this.auth.getProfile(user.id);
  }

  @ApiOkResponse({ schema: profileSchema })
  @Patch('me')
  @ApiOperation({ summary: 'Update firstName, lastName or HTTPS avatarUrl only' })
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto);
  }

  @Post('change-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: minute } })
  @ApiOperation({ summary: 'Change password; revokes every session including current session' })
  async changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    await this.credentials.changePassword(user.id, dto);
    return { message: 'Password changed; sign in again' };
  }

  @Public()
  @ApiOperation({ security: [] })
  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: minute } })
  @ApiOperation({ summary: 'Request 30-minute reset token; generic response for every email' })
  @ApiResponse({
    status: 503,
    description: 'Mail provider is not configured (same response for all addresses)',
  })
  async forgot(@Body() dto: EmailDto) {
    await this.credentials.request(dto.email, 'reset');
    return genericEmailMessage;
  }

  @Public()
  @ApiOperation({ security: [] })
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: minute } })
  @ApiOperation({ summary: 'Consume single-use reset token; revoke all sessions' })
  async reset(@Body() dto: ResetPasswordDto) {
    await this.credentials.consume(dto.token, 'reset', dto);
    return { message: 'Password reset; sign in again' };
  }

  @Public()
  @ApiOperation({ security: [] })
  @Post('resend-verification')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: minute } })
  @ApiOperation({
    summary:
      'Request 24-hour verification token; generic response including verified/unknown users',
  })
  async resend(@Body() dto: EmailDto) {
    await this.credentials.request(dto.email, 'verify');
    return genericEmailMessage;
  }

  @Public()
  @ApiOperation({ security: [] })
  @Post('verify-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: minute } })
  @ApiOperation({ summary: 'Consume single-use email verification token' })
  async verify(@Body() dto: CredentialTokenDto) {
    await this.credentials.consume(dto.token, 'verify');
    return { message: 'Email verified' };
  }
}
