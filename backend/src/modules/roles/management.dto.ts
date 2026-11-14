import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AuthorizationScope,
  RoleGroup,
  RoleStatus,
  ApprovalType,
  ApprovalStatus,
} from '@prisma/client';
import { PaginationQueryDto } from '../../shared/sdk';
export class ManagedRoleDto {
  @ApiProperty() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,49}$/) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) description?: string;
  @ApiProperty({ enum: RoleGroup }) @IsEnum(RoleGroup) group!: RoleGroup;
  @ApiProperty({ enum: AuthorizationScope })
  @IsEnum(AuthorizationScope)
  scopeType!: AuthorizationScope;
  @ApiPropertyOptional() @IsOptional() @IsUUID() scopeId?: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  permissionIds!: string[];
  @ApiProperty({ enum: RoleStatus }) @IsEnum(RoleStatus) status!: RoleStatus;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
}
export class AssignmentDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsUUID() roleId!: string;
  @ApiProperty({ enum: AuthorizationScope })
  @IsEnum(AuthorizationScope)
  scopeType!: AuthorizationScope;
  @ApiPropertyOptional() @IsOptional() @IsUUID() scopeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) expiresAt?: string;
}
export class ApprovalCreateDto {
  @ApiProperty({ enum: ApprovalType }) @IsEnum(ApprovalType) type!: ApprovalType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() beneficiaryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() roleId?: string;
  @ApiProperty({ enum: AuthorizationScope })
  @IsEnum(AuthorizationScope)
  scopeType!: AuthorizationScope;
  @ApiPropertyOptional() @IsOptional() @IsUUID() scopeId?: string;
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 1000)
  reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) expiresAt?: string;
}
export class ApprovalDecisionDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 1000)
  reason!: string;
}
export class ApprovalQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ApprovalType })
  @IsOptional()
  @IsEnum(ApprovalType)
  type?: ApprovalType;
  @ApiPropertyOptional({ enum: ApprovalStatus })
  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;
}
export class EnrollmentPolicyDto {
  @ApiProperty() @IsBoolean() requireApproval!: boolean;
}
export class DelegationPolicyDto extends OmitType(AssignmentDto, ['roleId'] as const) {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  permissionIds!: string[];
  @ApiProperty({ enum: RoleGroup, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsEnum(RoleGroup, { each: true })
  allowedGroups!: RoleGroup[];
}
