ALTER TABLE "ai_providers" ADD COLUMN "type" VARCHAR(32) NOT NULL DEFAULT 'openai';
UPDATE "ai_providers" SET "type"='anthropic' WHERE "id"='anthropic';
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_provider_type_check" CHECK ("type" IN ('openai','anthropic','gemini','openai-compatible'));
ALTER TABLE "ai_usage_records"
  ADD COLUMN "credential_id" VARCHAR(64),
  ADD COLUMN "endpoint_id" VARCHAR(64),
  ADD COLUMN "provider_type" VARCHAR(32),
  ADD COLUMN "account_group" VARCHAR(64);
CREATE INDEX "ai_usage_records_account_group_started_at_idx" ON "ai_usage_records"("account_group","started_at");
CREATE INDEX "ai_usage_records_provider_id_credential_id_started_at_idx" ON "ai_usage_records"("provider_id","credential_id","started_at");
