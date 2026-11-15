-- Contains AES-256-GCM encrypted credentials and provider metadata, never plaintext secrets.
-- TEXT is intentional: JSONB normalizes property ordering and breaks existing credential AAD.
CREATE TABLE "ai_provider_vaults" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'default',
    "revision" BIGINT NOT NULL DEFAULT 0,
    "payload" TEXT NOT NULL,
    "backup_payload" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_provider_vaults_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_provider_vaults_revision_nonnegative" CHECK ("revision" >= 0)
);
