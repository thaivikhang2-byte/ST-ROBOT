CREATE TABLE "operational_alerts" (
 "code" VARCHAR(80) PRIMARY KEY, "severity" VARCHAR(20) NOT NULL,
 "status" VARCHAR(20) NOT NULL DEFAULT 'open',
 "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "resolved_at" TIMESTAMP(3), "occurrences" INTEGER NOT NULL DEFAULT 1,
 "details" JSONB
);
CREATE INDEX "operational_alerts_status_last_seen_at_idx" ON "operational_alerts"("status", "last_seen_at");
CREATE INDEX "ai_usage_records_started_at_idx" ON "ai_usage_records"("started_at");
