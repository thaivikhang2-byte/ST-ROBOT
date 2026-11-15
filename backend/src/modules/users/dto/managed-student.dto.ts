import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NormalizeEmail, Password } from '../../auth/dto/credential.dto';

export class ManagedStudentDto {
  @ApiProperty() @NormalizeEmail() @IsEmail() @MaxLength(255)
  email!: string;

  @Password()
  password!: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100)
  firstName!: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100)
  lastName!: string;
}

export class ManagedStudentPasswordDto {
  @Password()
  newPassword!: string;
}
