import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { aiConnection } from '../ai-http';
import { Throttle } from '@nestjs/throttler';
import { AiAgentMode } from '@prisma/client';
import { CurrentUser, Permissions } from '../../../shared/sdk';
import type { RequestUser } from '../../../shared/sdk';
import { AiAgentService } from './ai-agent.service';
import {
  AgentChatDto,
  ActionDecisionDto,
  ActionControlDto,
  AgentConversationQueryDto,
  AgentModeQueryDto,
  MemoryDecisionDto,
  MemoryPreferenceDto,
} from './agent.dto';

@ApiTags('AI Agents')
@ApiBearerAuth('access-token')
@Permissions('ai:chat')
@Controller('v1/ai/agent')
export class AiAgentController {
  constructor(private readonly agents: AiAgentService) {}

  @Post('chat')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary:
      'Continue or create an owner-isolated Educational, Personal or Management conversation',
  })
  async chat(
    @CurrentUser() user: RequestUser,
    @Body() dto: AgentChatDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const connection = aiConnection(response, 110000);
    try {
      return await this.agents.chat(user, dto, connection.signal);
    } finally {
      connection.close();
    }
  }

  @Post('chat/stream')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary:
      'Agent lifecycle SSE; final generated text is emitted as message.completed, not simulated token deltas',
  })
  async stream(
    @CurrentUser() user: RequestUser,
    @Body() dto: AgentChatDto,
    @Res() response: Response,
  ) {
    const connection = aiConnection(response, 110000);
    const emit = (type: string, data: Record<string, unknown>) => {
      if (response.destroyed || connection.signal.aborted) return;
      if (!response.headersSent) {
        response.status(200).set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        });
        response.flushHeaders();
      }
      response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const result = await this.agents.chat(user, dto, connection.signal, emit);
      emit('message.completed', result);
      emit('run.completed', {});
      response.end();
    } catch (error) {
      if (!response.headersSent) throw error;
      emit('error', {
        message: 'AI agent could not complete this turn',
        code: connection.signal.aborted ? 'interrupted' : 'agent_failed',
      });
      response.end();
    } finally {
      connection.close();
    }
  }

  @Get('capabilities')
  @ApiOperation({
    summary: 'List server-registered tools allowed by the current role and requested partition',
  })
  async capabilities(@CurrentUser() user: RequestUser, @Query() query: AgentModeQueryDto) {
    return this.agents.capabilities(user, query.mode);
  }

  @Get('status')
  @ApiOperation({ summary: 'Check local agent configuration without calling a paid provider' })
  async status(@CurrentUser() user: RequestUser, @Query() query: AgentModeQueryDto) {
    return this.agents.configurationStatus(user, query.mode);
  }

  @Get('conversations')
  conversations(@CurrentUser() user: RequestUser, @Query() query: AgentConversationQueryDto) {
    return this.agents.conversations(user, query.mode, query.limit ?? 20);
  }

  @Get('conversations/:id')
  history(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.history(user, id);
  }

  @Delete('conversations/:id')
  deleteConversation(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.deleteConversation(user, id);
  }

  @Get('actions/proposals')
  @ApiOperation({ summary: 'List the current user’s pending, owner-isolated action previews' })
  actionProposals(@CurrentUser() user: RequestUser) {
    return this.agents.actionProposals(user);
  }

  @Get('management/status')
  @ApiOperation({
    summary:
      'Retrieve Management AI system status: prompts, routing, cache metrics, RAG docs, provider circuit states, and action controls',
  })
  managementStatus(@CurrentUser() user: RequestUser) {
    return this.agents.managementSystemStatus(user);
  }

  @Post('management/cache/invalidate')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Invalidate L1 exact and L2 semantic AI question caches' })
  invalidateCache(@CurrentUser() user: RequestUser, @Body() body?: { partition?: string }) {
    return this.agents.invalidateCache(user, body?.partition);
  }

  @Get('actions/control')
  @ApiOperation({ summary: 'Read the AI write kill switch; requires system management authority' })
  actionControl(@CurrentUser() user: RequestUser) {
    return this.agents.actionControl(user);
  }

  @Patch('actions/control')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Set the AI write kill switch; every change is audited' })
  setActionControl(@CurrentUser() user: RequestUser, @Body() dto: ActionControlDto) {
    return this.agents.setActionControl(user, dto.enabled);
  }

  @Post('actions/proposals/:id/confirm')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Explicitly confirm and execute a pending R2 course draft action' })
  confirmAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActionDecisionDto,
  ) {
    return this.agents.decideAction(user, id, dto, true);
  }

  @Post('actions/proposals/:id/reject')
  rejectAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActionDecisionDto,
  ) {
    return this.agents.decideAction(user, id, dto, false);
  }

  @Get('memory/preferences')
  memoryPreference(@CurrentUser() user: RequestUser) {
    return this.agents.memoryPreference(user);
  }

  @Patch('memory/entries/:id')
  @ApiOperation({
    summary: 'Explicitly replace your saved memory with the exact submitted non-sensitive text',
  })
  editMemory(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MemoryDecisionDto,
  ) {
    return this.agents.editMemory(user, id, dto.content ?? '');
  }

  @Patch('memory/preferences')
  setMemoryPreference(@CurrentUser() user: RequestUser, @Body() dto: MemoryPreferenceDto) {
    return this.agents.setMemoryPreference(user, dto.enabled);
  }

  @Get('memory/proposals')
  memoryProposals(@CurrentUser() user: RequestUser) {
    return this.agents.memoryProposals(user);
  }

  @Post('memory/proposals/:id/confirm')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  confirmMemory(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MemoryDecisionDto,
  ) {
    return this.agents.decideMemory(user, id, true, dto.content);
  }

  @Post('memory/proposals/:id/reject')
  rejectMemory(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.decideMemory(user, id, false);
  }

  @Get('memory')
  memories(@CurrentUser() user: RequestUser, @Query('mode') mode?: AiAgentMode) {
    return this.agents.memories(user, mode);
  }

  @Delete('memory/:id')
  revokeMemory(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.revokeMemory(user, id);
  }
}
