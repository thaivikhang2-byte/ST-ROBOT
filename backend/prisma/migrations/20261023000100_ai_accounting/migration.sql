ALTER TABLE "ai_models" ADD COLUMN "fallback_model_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ai_usage_records"
  ADD COLUMN "total_tokens" INTEGER,
  ADD COLUMN "input_price" DECIMAL(18,8),
  ADD COLUMN "output_price" DECIMAL(18,8),
  ADD COLUMN "fallback_from" UUID;

CREATE UNIQUE INDEX "ai_models_one_default" ON "ai_models" ("is_default") WHERE "is_default" = true;
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_model_limits" CHECK (
  max_input_tokens > 0 AND max_output_tokens > 0 AND context_tokens >= max_input_tokens + max_output_tokens
  AND (NOT is_default OR enabled)
  AND (input_price IS NULL OR input_price >= 0) AND (output_price IS NULL OR output_price >= 0)
);
ALTER TABLE "ai_quota_policies" ADD CONSTRAINT "ai_quota_limits" CHECK (
  daily_requests >= 0 AND daily_tokens >= 0 AND requests_per_minute > 0 AND max_concurrent > 0
);
ALTER TABLE "ai_usage_buckets" ADD CONSTRAINT "ai_bucket_nonnegative" CHECK (requests >= 0 AND charged_tokens >= 0);
