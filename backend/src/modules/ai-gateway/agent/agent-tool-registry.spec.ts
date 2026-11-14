import { AiAgentMode } from '@prisma/client';
import { AgentToolRegistry } from './agent-tool-registry';

describe('AgentToolRegistry', () => {
  const registry = new AgentToolRegistry();

  it('fails closed by exposing only registered tools compatible with the mode and permissions', () => {
    expect(registry.available(AiAgentMode.PERSONAL, [])).toEqual([
      expect.objectContaining({ name: 'learning_search_courses' }),
      expect.objectContaining({ name: 'memory_propose' }),
    ]);
    expect(registry.available(AiAgentMode.EDUCATIONAL, [])).not.toContainEqual(
      expect.objectContaining({ name: 'learning_get_own_progress' }),
    );
    expect(registry.available(AiAgentMode.EDUCATIONAL, ['learning:read'])).toContainEqual(
      expect.objectContaining({ name: 'learning_get_own_progress' }),
    );
    expect(registry.available(AiAgentMode.MANAGEMENT, [])).not.toContainEqual(
      expect.objectContaining({ name: 'admin_get_system_overview' }),
    );
    expect(registry.available(AiAgentMode.MANAGEMENT, ['system:read'])).toContainEqual(
      expect.objectContaining({ name: 'admin_get_system_overview' }),
    );
  });

  it('registers only the approved R2 controlled management write actions and never registers an R3 action', () => {
    const writeTools = registry.all().filter((tool) => tool.riskLevel === 'R2');
    expect(writeTools.map((t) => t.name)).toEqual([
      'management_propose_course_draft',
      'management_prepare_announcement',
      'management_create_admin_note',
      'management_update_course_info',
      'management_propose_course_publish',
    ]);
    for (const tool of writeTools) {
      expect(tool.agentModes).toEqual([AiAgentMode.MANAGEMENT]);
      expect(tool.requiresConfirmation).toBe(true);
    }
    expect(registry.all().some((tool) => tool.riskLevel === 'R3')).toBe(false);
  });
});
