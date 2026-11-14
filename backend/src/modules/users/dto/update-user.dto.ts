import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsUUID,
  IsBoolean,
  ValidateIf,
  IsUrl,
} from 'class-validator';
import { NormalizeEmail } from '../../auth/dto/credential.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'user@example.com' })
  @ValidateIf((_object, value) => value !== undefined)
  @NormalizeEmail()
  @MaxLength(255)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'John' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  avatarUrl?: string;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  roleId?: string;
}
