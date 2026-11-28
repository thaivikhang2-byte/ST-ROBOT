-- The optional monetary guard is disabled until an operator confirms prices.
-- Existing model configuration, credentials and usage remain unchanged.
ALTER TABLE "ai_usage_records" ADD COLUMN "reserved_cost_usd" DECIMAL(18,8);
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_reserved_cost_check"
  CHECK ("reserved_cost_usd" IS NULL OR "reserved_cost_usd" >= 0);
CREATE TABLE "ai_spend_policies" (
  "id" VARCHAR(20) NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "economy_enabled" BOOLEAN NOT NULL DEFAULT true,
  "total_budget_usd" DECIMAL(18,8) NOT NULL,
  "daily_budget_usd" DECIMAL(18,8) NOT NULL,
  "reserve_usd" DECIMAL(18,8) NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "reserve_from" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updated_by_id" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_spend_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_spend_policies_singleton" CHECK ("id" = 'default'),
  CONSTRAINT "ai_spend_policies_amounts" CHECK (
    "total_budget_usd" > 0 AND "total_budget_usd" <= 1000 AND
    "daily_budget_usd" > 0 AND "daily_budget_usd" <= "total_budget_usd" AND
    "reserve_usd" >= 0 AND "reserve_usd" <= "total_budget_usd"),
  CONSTRAINT "ai_spend_policies_window" CHECK ("starts_at" < "reserve_from" AND "reserve_from" < "ends_at"),
  CONSTRAINT "ai_spend_policies_revision" CHECK ("revision" > 0)
);
