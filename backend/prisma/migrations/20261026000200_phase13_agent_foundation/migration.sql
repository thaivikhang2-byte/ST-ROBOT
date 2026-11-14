CREATE TYPE "AiAgentMode" AS ENUM ('PERSONAL', 'EDUCATIONAL', 'MANAGEMENT');
CREATE TYPE "AiConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AiMemoryProposalStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'EXPIRED');

CREATE TABLE "ai_conversations" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "mode" "AiAgentMode" NOT NULL,
  "resource_scope" VARCHAR(36),
  "status" "AiConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "last_user_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "active_run_id" UUID,
  "active_run_started_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ai_conversations_owner_id_mode_last_user_activity_at_idx" ON "ai_conversations"("owner_id", "mode", "last_user_activity_at");
CREATE INDEX "ai_conversations_status_expires_at_idx" ON "ai_conversations"("status", "expires_at");

CREATE TABLE "ai_conversation_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "role" VARCHAR(20) NOT NULL,
  "content" TEXT NOT NULL,
  "tool_calls" JSONB,
  "tool_call_id" VARCHAR(200),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_conversation_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ai_conversation_messages_conversation_id_created_at_id_idx" ON "ai_conversation_messages"("conversation_id", "created_at", "id");

CREATE TABLE "ai_memory_proposals" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "conversation_id" UUID,
  "mode" "AiAgentMode" NOT NULL,
  "content" VARCHAR(1000) NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" "AiMemoryProposalStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "confirmed_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_memory_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_memory_proposals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_memory_proposals_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_memory_proposals_owner_id_conversation_id_content_hash_key" ON "ai_memory_proposals"("owner_id", "conversation_id", "content_hash");
CREATE INDEX "ai_memory_proposals_owner_id_status_expires_at_idx" ON "ai_memory_proposals"("owner_id", "status", "expires_at");

CREATE TABLE "ai_memory_entries" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "mode" "AiAgentMode" NOT NULL,
  "content" VARCHAR(1000) NOT NULL,
  "source_conversation_id" UUID,
  "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_memory_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_memory_entries_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_memory_entries_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "ai_memory_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_memory_entries_source_conversation_id_fkey" FOREIGN KEY ("source_conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_memory_entries_proposal_id_key" ON "ai_memory_entries"("proposal_id");
CREATE INDEX "ai_memory_entries_owner_id_mode_revoked_at_idx" ON "ai_memory_entries"("owner_id", "mode", "revoked_at");

CREATE TABLE "ai_memory_preferences" (
  "owner_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_memory_preferences_pkey" PRIMARY KEY ("owner_id"),
  CONSTRAINT "ai_memory_preferences_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
