import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { AiProviderContextDto } from './ai.dto';

export class AiUsageResponseDto {
  @ApiProperty({ type: Number, nullable: true }) inputTokens!: number | null;
  @ApiProperty({ type: Number, nullable: true }) outputTokens!: number | null;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Provider-reported total; absent/null when not supplied',
  })
  totalTokens?: number | null;
}
export class AiToolCallResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }],
    description: 'Untrusted provider-generated arguments; caller must validate before execution',
  })
  arguments!: unknown;
}
export class AiChatResponseDto {
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({ enum: ['openai', 'anthropic'] }) provider!: string;
  @ApiProperty({ description: 'Resolved native provider model ID' }) model!: string;
  @ApiProperty() id!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ type: [AiToolCallResponseDto] }) toolCalls!: AiToolCallResponseDto[];
  @ApiProperty() finishReason!: string;
  @ApiProperty({ type: AiUsageResponseDto }) usage!: AiUsageResponseDto;
  @ApiProperty({
    type: [Object],
    description:
      'Native output blocks, including tool IDs and signed/encrypted reasoning metadata; never logged',
  })
  providerOutput!: object[];
  @ApiPropertyOptional({ type: [AiProviderContextDto], description: 'Opaque signed provider context; replay unchanged with the matching assistant tool call' })
  providerContext?: AiProviderContextDto[];
  @ApiPropertyOptional({ format: 'uuid' }) fallbackFrom?: string;
}
export class AiEmbeddingResponseDto {
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() model!: string;
  @ApiProperty({ type: 'array', items: { type: 'array', items: { type: 'number' } } })
  vectors!: number[][];
  @ApiProperty({ type: AiUsageResponseDto }) usage!: AiUsageResponseDto;
}
export const chatResponseSchema = {
  type: 'object' as const,
  properties: {
    success: { type: 'boolean' as const },
    message: { type: 'string' as const },
    data: { $ref: getSchemaPath(AiChatResponseDto) },
  },
};
export const embeddingResponseSchema = {
  type: 'object' as const,
  properties: {
    success: { type: 'boolean' as const },
    message: { type: 'string' as const },
    data: { $ref: getSchemaPath(AiEmbeddingResponseDto) },
  },
};
