import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { NormalizeEmail } from './credential.dto';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@st-robot.com' })
  @IsEmail()
  @NormalizeEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password!: string;
}
