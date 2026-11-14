import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiAgentMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AgentChatDto {
  @ApiProperty({ enum: AiAgentMode }) @IsEnum(AiAgentMode) mode!: AiAgentMode;
  @ApiProperty({ maxLength: 4000 }) @IsString() @Length(1, 4000) message!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() conversationId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() modelId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() courseId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() lessonId?: string;
}

export class AgentConversationQueryDto {
  @ApiPropertyOptional({ enum: AiAgentMode }) @IsOptional() @IsEnum(AiAgentMode) mode?: AiAgentMode;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AgentModeQueryDto {
  @ApiPropertyOptional({ enum: AiAgentMode, default: AiAgentMode.PERSONAL })
  @IsOptional()
  @IsEnum(AiAgentMode)
  mode: AiAgentMode = AiAgentMode.PERSONAL;
}

export class MemoryDecisionDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content?: string;
}

export const ACTION_CONFIRMATION_CODES = [
  'CREATE_DRAFT',
  'PUBLISH_ANNOUNCEMENT',
  'CREATE_ADMIN_NOTE',
  'UPDATE_COURSE_INFO',
  'PUBLISH_COURSE',
] as const;

export class ActionDecisionDto {
  @ApiProperty({ minLength: 64, maxLength: 64 })
  @IsString()
  @Length(64, 64)
  payloadHash!: string;

  @ApiPropertyOptional({ enum: ACTION_CONFIRMATION_CODES })
  @IsOptional()
  @IsString()
  @IsIn(ACTION_CONFIRMATION_CODES)
  confirmation!: string;
}

export class ActionControlDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class MemoryPreferenceDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
