import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  ValidateIf,
  IsUrl,
  Matches,
  ValidateBy,
} from 'class-validator';

export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

export function Password() {
  return applyDecorators(
    ApiProperty({
      minLength: 12,
      maxLength: 72,
      description: '12+ characters, at most 72 UTF-8 bytes; no NUL characters',
    }),
    IsString(),
    MinLength(12),
    MaxLength(72),
    ValidateBy({
      name: 'passwordBytes',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          Buffer.byteLength(value, 'utf8') <= 72 &&
          !value.includes('\0'),
        defaultMessage: () => 'Password must be at most 72 UTF-8 bytes and contain no NUL',
      },
    }),
  );
}

export class EmailDto {
  @ApiProperty({ example: 'user@example.com' })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class CredentialTokenDto {
  @ApiProperty({ description: 'Single-use token delivered by email (64 hexadecimal characters)' })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token!: string;
}

export class ResetPasswordDto extends CredentialTokenDto {
  @Password()
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  currentPassword!: string;

  @Password()
  newPassword!: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  avatarUrl?: string;
}
