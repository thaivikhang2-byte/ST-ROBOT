CREATE TYPE "AiActionProposalStatus" AS ENUM ('PENDING_CONFIRMATION', 'COMPLETED', 'REJECTED', 'EXPIRED');

CREATE TABLE "ai_action_proposals" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "mode" "AiAgentMode" NOT NULL,
    "action_type" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "status" "AiActionProposalStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_action_proposals_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "courses" ADD COLUMN "ai_action_proposal_id" UUID;
CREATE UNIQUE INDEX "courses_ai_action_proposal_id_key" ON "courses"("ai_action_proposal_id");
CREATE INDEX "ai_action_proposals_owner_id_status_expires_at_idx" ON "ai_action_proposals"("owner_id", "status", "expires_at");
CREATE INDEX "ai_action_proposals_conversation_id_created_at_idx" ON "ai_action_proposals"("conversation_id", "created_at");

ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "courses" ADD CONSTRAINT "courses_ai_action_proposal_id_fkey"
  FOREIGN KEY ("ai_action_proposal_id") REFERENCES "ai_action_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
