import { NormalizeEmail, Password } from '../../auth/dto/credential.dto';
import { IsEmail, IsString, MinLength, MaxLength, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @NormalizeEmail()
  @MaxLength(255)
  @IsEmail()
  email!: string;

  @Password()
  password!: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ description: 'Role ID' })
  @IsUUID()
  roleId!: string;
}
