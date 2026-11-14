import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  Matches,
  MaxLength,
  IsOptional,
  IsUUID,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
} from 'class-validator';
export class CreateRoleDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{1,49}$/)
  name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
export class UpdateRoleDto extends PartialType(CreateRoleDto, { skipNullProperties: false }) {}
export class RolePermissionsDto {
  @ApiProperty({ type: [String], description: 'UUIDs of existing permissions' })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  permissionIds!: string[];
}
