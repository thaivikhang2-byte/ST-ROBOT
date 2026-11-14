CREATE TABLE "ai_agent_controls" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'default',
    "writes_enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_agent_controls_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ai_agent_controls" ("id", "writes_enabled", "revision", "updated_at")
VALUES ('default', false, 0, CURRENT_TIMESTAMP);

ALTER TABLE "ai_agent_controls" ADD CONSTRAINT "ai_agent_controls_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
