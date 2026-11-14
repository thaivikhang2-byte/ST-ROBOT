import { Injectable } from '@nestjs/common';
import type { AiAgentMode } from '@prisma/client';
import type { AiToolDto } from '../ai.dto';
import { educationalToolDefinitions } from './educational-tools.service';
import { managementToolDefinitions } from './management-tools.service';

export type AgentRisk = 'R0' | 'R1' | 'R2' | 'R3';
export interface AgentToolDefinition {
  name: string;
  description: string;
  agentModes: AiAgentMode[];
  inputSchema: Record<string, unknown>;
  requiredPermissions: string[];
  riskLevel: AgentRisk;
  requiresConfirmation: boolean;
  timeoutMs: number;
  outputSchema?: Record<string, unknown>;
  scopePolicy?: string;
  retryPolicy?: 'never';
  auditBehavior?: 'metadata-only';
}

const definitions: AgentToolDefinition[] = [
  ...educationalToolDefinitions,
  ...managementToolDefinitions,
  {
    name: 'learning_search_courses',
    description: 'Search published robotics courses that are visible in the public catalog.',
    agentModes: ['PERSONAL', 'EDUCATIONAL', 'MANAGEMENT'],
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1, maxLength: 120 } },
      required: ['query'],
      additionalProperties: false,
    },
    requiredPermissions: [],
    riskLevel: 'R0',
    requiresConfirmation: false,
    timeoutMs: 5000,
  },
  {
    name: 'learning_get_own_progress',
    description:
      'Read the authenticated learner’s own recent progress in active published enrollments.',
    agentModes: ['EDUCATIONAL'],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    requiredPermissions: ['learning:read'],
    riskLevel: 'R0',
    requiresConfirmation: false,
    timeoutMs: 5000,
  },
  {
    name: 'admin_get_system_overview',
    description: 'Read the real system and operations overview for an authorized system manager.',
    agentModes: ['MANAGEMENT'],
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    requiredPermissions: ['system:read'],
    riskLevel: 'R0',
    requiresConfirmation: false,
    timeoutMs: 10000,
  },
  {
    name: 'management_propose_course_draft',
    description:
      'Prepare a course draft preview for an authorized course manager. This only creates a pending proposal; a human must confirm it before any course is written.',
    agentModes: ['MANAGEMENT'],
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 120 },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
      },
      required: ['title', 'description'],
      additionalProperties: false,
    },
    requiredPermissions: ['courses:create'],
    riskLevel: 'R2',
    requiresConfirmation: true,
    timeoutMs: 5000,
  },
  {
    name: 'management_prepare_announcement',
    description:
      'Prepare a system or staff announcement preview for explicit human confirmation before any notification is sent.',
    agentModes: ['MANAGEMENT'],
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 120 },
        body: { type: 'string', minLength: 3, maxLength: 2000 },
        audience: { type: 'string', enum: ['SYSTEM', 'TEACHERS', 'MANAGERS'] },
      },
      required: ['title', 'body', 'audience'],
      additionalProperties: false,
    },
    requiredPermissions: ['system:manage'],
    riskLevel: 'R2',
    requiresConfirmation: true,
    timeoutMs: 5000,
  },
  {
    name: 'management_create_admin_note',
    description:
      'Prepare an administrative operational note proposal for explicit confirmation and durable audit logging.',
    agentModes: ['MANAGEMENT'],
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', minLength: 3, maxLength: 120 },
        note: { type: 'string', minLength: 3, maxLength: 2000 },
      },
      required: ['subject', 'note'],
      additionalProperties: false,
    },
    requiredPermissions: ['system:read'],
    riskLevel: 'R2',
    requiresConfirmation: true,
    timeoutMs: 5000,
  },
  {
    name: 'management_update_course_info',
    description:
      'Propose updating non-sensitive course information (title and description) for an existing authorized course; requires explicit human confirmation.',
    agentModes: ['MANAGEMENT'],
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'string', minLength: 36, maxLength: 36 },
        title: { type: 'string', minLength: 3, maxLength: 120 },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
      },
      required: ['courseId', 'title', 'description'],
      additionalProperties: false,
    },
    requiredPermissions: ['courses:update'],
    riskLevel: 'R2',
    requiresConfirmation: true,
    timeoutMs: 5000,
  },
  {
    name: 'management_propose_course_publish',
    description:
      'Propose publishing an authorized draft course that has published lessons; requires explicit human confirmation.',
    agentModes: ['MANAGEMENT'],
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'string', minLength: 36, maxLength: 36 },
        reason: { type: 'string', minLength: 3, maxLength: 500 },
      },
      required: ['courseId', 'reason'],
      additionalProperties: false,
    },
    requiredPermissions: ['courses:publish'],
    riskLevel: 'R2',
    requiresConfirmation: true,
    timeoutMs: 5000,
  },
  {
    name: 'memory_propose',
    description:
      'Propose a non-sensitive learning preference for explicit user review; this does not save an active memory.',
    agentModes: ['PERSONAL', 'EDUCATIONAL'],
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', minLength: 1, maxLength: 1000 },
        reason: { type: 'string', minLength: 1, maxLength: 500 },
      },
      required: ['content', 'reason'],
      additionalProperties: false,
    },
    requiredPermissions: [],
    riskLevel: 'R1',
    requiresConfirmation: true,
    timeoutMs: 5000,
  },
];

@Injectable()
export class AgentToolRegistry {
  all(): readonly AgentToolDefinition[] {
    return definitions.map((tool) => ({
      outputSchema: { type: ['object', 'array'] },
      scopePolicy: 'Recheck current actor and handler resource authorization on every execution',
      retryPolicy: 'never' as const,
      auditBehavior: 'metadata-only' as const,
      ...tool,
    }));
  }

  available(mode: AiAgentMode, permissions: string[]): AgentToolDefinition[] {
    return this.all().filter(
      (tool) =>
        tool.agentModes.includes(mode) &&
        tool.requiredPermissions.every((permission) => permissions.includes(permission)),
    );
  }

  find(name: string): AgentToolDefinition | undefined {
    return this.all().find((tool) => tool.name === name);
  }

  asProviderTools(tools: AgentToolDefinition[]): AiToolDto[] {
    return tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      parameters: inputSchema,
    }));
  }
}
