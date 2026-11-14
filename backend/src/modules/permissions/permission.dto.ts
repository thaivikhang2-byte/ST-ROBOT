import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, IsOptional } from 'class-validator';
export class CreatePermissionDto {
  @ApiProperty({ example: 'courses:read' })
  @IsString()
  @Matches(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/)
  @MaxLength(100)
  name!: string;
  @ApiProperty()
  @IsString()
  @Matches(/^[a-z][a-z0-9-]*$/)
  @MaxLength(50)
  resource!: string;
  @ApiProperty()
  @IsString()
  @Matches(/^[a-z][a-z0-9-]*$/)
  @MaxLength(50)
  action!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
export class UpdatePermissionDto extends PartialType(CreatePermissionDto, {
  skipNullProperties: false,
}) {}
