import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiProduces,
  ApiCreatedResponse,
  ApiExtraModels,
} from '@nestjs/swagger';
import {
  AiChatResponseDto,
  AiEmbeddingResponseDto,
  chatResponseSchema,
  embeddingResponseSchema,
} from './ai-response.dto';
import type { Response } from 'express';
import { AiGatewayService } from './ai-gateway.service';
import { AiRegistryService } from './ai-registry.service';
import { AiChatDto, AiEmbeddingDto, AiUsageQueryDto } from './ai.dto';
import { CurrentUser, Permissions } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { aiConnection, sendAiStream } from './ai-http';

@ApiTags('Ai Gateway')
@ApiExtraModels(AiChatResponseDto, AiEmbeddingResponseDto)
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Valid access token and active session required' })
@ApiResponse({ status: 403, description: 'Verified email and explicit AI permission required' })
@ApiResponse({
  status: 429,
  description: 'Rate, concurrency or daily reserved token budget exhausted',
})
@ApiResponse({ status: 503, description: 'Gateway disabled or provider/model not configured' })
@Controller(['v1/ai', 'v1/ai-gateway'])
export class AiGatewayController {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly registry: AiRegistryService,
    private readonly config: ConfigService,
  ) {}

  @Get('providers')
  @Permissions('ai:usage')
  @ApiOperation({ summary: 'List provider availability; never returns API keys' })
  providers() {
    return this.registry.providers();
  }

  @Get('models')
  @Permissions('ai:usage')
  @ApiOperation({ summary: 'List enabled models permitted for the current user' })
  models(@CurrentUser() user: RequestUser) {
    return this.registry.models(user);
  }

  @Get('usage')
  @Permissions('ai:usage')
  @ApiOperation({ summary: 'Paginated own usage; prompts and generated content are not logged' })
  usage(@CurrentUser() user: RequestUser, @Query() query: AiUsageQueryDto) {
    return this.gateway.usage(user.id, query);
  }

  @Post('chat')
  @ApiCreatedResponse({ schema: chatResponseSchema })
  @Permissions('ai:chat')
  @ApiOperation({
    summary: 'Generate text/tool calls through the selected provider; no tool execution',
  })
  async chat(
    @CurrentUser() user: RequestUser,
    @Body() dto: AiChatDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const connection = this.connection(response);
    try {
      return await this.gateway.chat(user, dto, connection.signal);
    } finally {
      connection.close();
    }
  }

  @Post('responses')
  @ApiCreatedResponse({ schema: chatResponseSchema })
  @Permissions('ai:chat')
  @ApiOperation({
    summary: 'OpenAI Responses generation using the validated unified text/tool contract',
  })
  async responses(
    @CurrentUser() user: RequestUser,
    @Body() dto: AiChatDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const connection = this.connection(response);
    try {
      return await this.gateway.chat(user, dto, connection.signal, true);
    } finally {
      connection.close();
    }
  }

  @Post('embeddings')
  @ApiCreatedResponse({ schema: embeddingResponseSchema })
  @Permissions('ai:embeddings')
  @ApiOperation({ summary: 'Create embeddings with an explicitly registered capable model' })
  async embeddings(
    @CurrentUser() user: RequestUser,
    @Body() dto: AiEmbeddingDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const connection = this.connection(response);
    try {
      return await this.gateway.embeddings(user, dto, connection.signal);
    } finally {
      connection.close();
    }
  }

  @Post('chat/stream')
  @Permissions('ai:chat')
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'POST SSE: metadata/start/text/tool/usage/end; failures emit error without end',
  })
  async stream(
    @CurrentUser() user: RequestUser,
    @Body() dto: AiChatDto,
    @Res() response: Response,
  ) {
    const connection = this.connection(response);
    try {
      await sendAiStream(
        response,
        this.gateway.stream(user, dto, connection.signal),
        connection.signal,
      );
    } finally {
      connection.close();
    }
  }

  private connection(response: Response) {
    return aiConnection(response, Number(this.config.get('AI_REQUEST_TIMEOUT_MS', 60000)));
  }
}
