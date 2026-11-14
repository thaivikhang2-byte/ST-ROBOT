import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../shared/sdk';

export class ToolCallDto {
  @ApiProperty() @IsString() @Length(1, 200) id!: string;
  @ApiProperty() @Matches(/^[a-zA-Z0-9_-]{1,64}$/) name!: string;
  @ApiProperty({ type: Object }) @IsObject() arguments!: Record<string, unknown>;
}
export class AiProviderContextDto {
  @ApiProperty({ enum: ['openai_reasoning', 'anthropic_thinking', 'anthropic_redacted', 'gemini_thinking'] })
  @IsIn(['openai_reasoning', 'anthropic_thinking', 'anthropic_redacted', 'gemini_thinking'])
  type!: 'openai_reasoning' | 'anthropic_thinking' | 'anthropic_redacted' | 'gemini_thinking';
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 200)
  id?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 30000)
  encryptedContent?: string;
  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @MaxLength(10000, { each: true })
  summary?: string[];
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(30000)
  thinking?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 30000)
  signature?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 30000)
  data?: string;
}
export class AiInlineImageDto {
  @ApiProperty({ enum: ['image/png', 'image/jpeg', 'image/webp'] })
  @IsIn(['image/png', 'image/jpeg', 'image/webp'])
  mimeType!: string;
  @ApiProperty({ maxLength: 24000 })
  @IsString()
  @Length(8, 24000)
  @Matches(/^[A-Za-z0-9+/]+={0,2}$/)
  dataBase64!: string;
}
export class AiMessageDto {
  @ApiPropertyOptional({ type: [AiInlineImageDto] })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => AiInlineImageDto)
  images?: AiInlineImageDto[];
  @ApiPropertyOptional({
    type: [AiProviderContextDto],
    description:
      'Signed/encrypted provider blocks from an earlier assistant response; reasoning_context capability required',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => AiProviderContextDto)
  providerContext?: AiProviderContextDto[];
  @ApiProperty({ enum: ['system', 'developer', 'user', 'assistant', 'tool'] })
  @IsIn(['system', 'developer', 'user', 'assistant', 'tool'])
  role!: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  @ApiProperty({ maxLength: 30000 }) @IsString() @MaxLength(30000) content!: string;
  @ApiPropertyOptional({ type: [ToolCallDto] })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => ToolCallDto)
  toolCalls?: ToolCallDto[];
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(1, 200)
  toolCallId?: string;
}
export class AiToolDto {
  @ApiProperty() @Matches(/^[a-zA-Z0-9_-]{1,64}$/) name!: string;
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(1000)
  description?: string;
  @ApiProperty({ type: Object, description: 'JSON Schema object; local references only' })
  @IsObject()
  parameters!: Record<string, unknown>;
}
export class AiOutputSchemaDto {
  @ApiProperty() @Matches(/^[a-zA-Z0-9_-]{1,64}$/) name!: string;
  @ApiProperty({ type: Object }) @IsObject() schema!: Record<string, unknown>;
}
export class AiChatDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Requires server opt-in; only before provider dispatch',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  allowFallback?: boolean;
  @ApiPropertyOptional({ description: 'Explicit deployment-approved provider instance ID', maxLength: 20 })
  @ValidateIf((_, value) => value !== undefined)
  @Matches(/^[a-zA-Z0-9_-]{1,20}$/)
  provider?: string;
  @ApiPropertyOptional({ description: 'Registry UUID, not an unrestricted upstream model name' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  modelId?: string;
  @ApiProperty({ type: [AiMessageDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => AiMessageDto)
  messages!: AiMessageDto[];
  @ApiPropertyOptional({ default: 1024, maximum: 16384 })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(16384)
  maxOutputTokens?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @ValidateIf((_, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1)
  temperature?: number;
  @ApiPropertyOptional({ type: [AiToolDto] })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => AiToolDto)
  tools?: AiToolDto[];
  @ApiPropertyOptional({ type: AiOutputSchemaDto })
  @ValidateIf((_, value) => value !== undefined)
  @ValidateNested()
  @Type(() => AiOutputSchemaDto)
  structuredOutput?: AiOutputSchemaDto;
}
export class AiEmbeddingDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() modelId!: string;
  @ApiProperty({ type: [String], maxItems: 32 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Length(1, 8000, { each: true })
  input!: string[];
}
export class CreateAiModelDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Up to three compatible registry UUIDs; no recursive fallback',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  fallbackModelIds?: string[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'USD per million input tokens; set together with outputPrice and pricingVersion',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/)
  inputPrice?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'USD per million output tokens' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/)
  outputPrice?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @Length(1, 100)
  pricingVersion?: string | null;
  @ApiProperty({ description: 'Approved provider instance ID' })
  @Matches(/^[a-zA-Z0-9_-]{1,20}$/)
  providerId!: string;
  @ApiProperty() @IsString() @Length(1, 200) @Matches(/^[a-zA-Z0-9@_.:/-]+$/) modelId!: string;
  @ApiPropertyOptional({ default: false })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;
  @ApiPropertyOptional({ default: false })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isDefault?: boolean;
  @ApiPropertyOptional({ default: false })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  premium?: boolean;
  @ApiProperty({
    type: [String],
    enum: [
      'chat',
      'responses',
      'streaming',
      'embeddings',
      'tools',
      'temperature',
      'structured_output',
      'reasoning_context',
      'vision',
    ],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(
    [
      'chat',
      'responses',
      'streaming',
      'embeddings',
      'tools',
      'temperature',
      'structured_output',
      'reasoning_context',
      'vision',
    ],
    { each: true },
  )
  capabilities!: string[];
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(16)
  @ArrayUnique()
  @Matches(/^[a-zA-Z0-9_-]{1,64}$/, { each: true })
  allowedTools!: string[];
  @ApiProperty() @IsInt() @Min(1) @Max(2000000) maxInputTokens!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(16384) maxOutputTokens!: number;
  @ApiProperty() @IsInt() @Min(2) @Max(2000000) contextTokens!: number;
}
export class UpdateAiModelDto extends PartialType(CreateAiModelDto, {
  skipNullProperties: false,
}) {}
export class ProviderStatusDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
export class AiQuotaDto {
  @ApiProperty() @IsInt() @Min(0) @Max(100000) dailyRequests!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100000000) dailyTokens!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) requestsPerMinute!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(20) maxConcurrent!: number;
}
export class AiUsageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  userId?: string;
}
