-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "category_id" UUID;

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" VARCHAR(20) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL,
    "provider_id" VARCHAR(20) NOT NULL,
    "model_id" VARCHAR(200) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "premium" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" TEXT[],
    "allowed_tools" TEXT[],
    "max_input_tokens" INTEGER NOT NULL,
    "max_output_tokens" INTEGER NOT NULL,
    "context_tokens" INTEGER NOT NULL,
    "input_price" DECIMAL(18,8),
    "output_price" DECIMAL(18,8),
    "pricing_version" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_quota_policies" (
    "id" VARCHAR(50) NOT NULL,
    "user_id" UUID,
    "daily_requests" INTEGER NOT NULL DEFAULT 20,
    "daily_tokens" INTEGER NOT NULL DEFAULT 50000,
    "requests_per_minute" INTEGER NOT NULL DEFAULT 5,
    "max_concurrent" INTEGER NOT NULL DEFAULT 1,
    "lock_version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_quota_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_buckets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "charged_tokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_id" VARCHAR(20) NOT NULL,
    "model_id" VARCHAR(200) NOT NULL,
    "endpoint" VARCHAR(30) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'reserved',
    "reserved_tokens" INTEGER NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "charged_tokens" INTEGER NOT NULL,
    "pricing_version" VARCHAR(100),
    "estimated_cost" DECIMAL(18,8),
    "error_category" VARCHAR(50),
    "provider_request_id" VARCHAR(200),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_deleted_at_is_active_idx" ON "categories"("deleted_at", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_provider_id_model_id_key" ON "ai_models"("provider_id", "model_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_quota_policies_user_id_key" ON "ai_quota_policies"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_buckets_user_id_day_key" ON "ai_usage_buckets"("user_id", "day");

-- CreateIndex
CREATE INDEX "ai_usage_records_user_id_started_at_idx" ON "ai_usage_records"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_status_deadline_at_idx" ON "ai_usage_records"("status", "deadline_at");

-- CreateIndex
CREATE INDEX "courses_category_id_idx" ON "courses"("category_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_quota_policies" ADD CONSTRAINT "ai_quota_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_buckets" ADD CONSTRAINT "ai_usage_buckets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
