import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/sdk';

export class UsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}

export class UserStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export class UserRoleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roleId!: string;
}
