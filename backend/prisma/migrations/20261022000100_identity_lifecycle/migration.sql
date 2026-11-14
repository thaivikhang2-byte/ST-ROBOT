-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auth_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "credential_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credential_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credential_tokens_token_hash_key" ON "credential_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "credential_tokens_user_id_purpose_idx" ON "credential_tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "credential_tokens_expires_at_idx" ON "credential_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "credential_tokens" ADD CONSTRAINT "credential_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
