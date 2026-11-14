import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway.module';
import { CoursesModule } from '../../courses/courses.module';
import { ProgressModule } from '../../progress/progress.module';
import { SystemModule } from '../../system/system.module';
import { AiAgentController } from './ai-agent.controller';
import { AiAgentService } from './ai-agent.service';
import { AgentToolRegistry } from './agent-tool-registry';
import { QuizzesModule } from '../../quizzes/quizzes.module';
import { EducationalToolsService } from './educational-tools.service';
import { ManagementToolsService } from './management-tools.service';
import { SystemPromptRegistryService } from '../prompts/system-prompt-registry.service';
import { AiRagService } from '../rag/ai-rag.service';
import { AiCacheService } from '../cache/ai-cache.service';
import { AiModelRouterService } from '../routing/ai-model-router.service';

@Module({
  imports: [AiGatewayModule, CoursesModule, ProgressModule, SystemModule, QuizzesModule],
  controllers: [AiAgentController],
  providers: [
    AiAgentService,
    AgentToolRegistry,
    EducationalToolsService,
    ManagementToolsService,
    SystemPromptRegistryService,
    AiRagService,
    AiCacheService,
    AiModelRouterService,
  ],
  exports: [
    AiAgentService,
    AgentToolRegistry,
    SystemPromptRegistryService,
    AiRagService,
    AiCacheService,
    AiModelRouterService,
  ],
})
export class AiAgentModule {}
