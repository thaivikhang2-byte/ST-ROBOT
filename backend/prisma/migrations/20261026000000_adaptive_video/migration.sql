-- AlterTable
ALTER TABLE "video_sessions" ADD COLUMN     "auth_family_id" UUID;

-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "completion_percent" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "hls_prefix" VARCHAR(500),
ADD COLUMN     "processing_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "processing_error" VARCHAR(100),
ADD COLUMN     "processing_lease" TIMESTAMP(3),
ADD COLUMN     "processing_percent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "provider" VARCHAR(20) NOT NULL DEFAULT 'legacy',
ADD COLUMN     "provider_uid" VARCHAR(100),
ADD COLUMN     "renditions" JSONB,
ADD COLUMN     "source_height" INTEGER,
ADD COLUMN     "source_width" INTEGER;

-- CreateTable
CREATE TABLE "video_playback_progress" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position_seconds" INTEGER NOT NULL DEFAULT 0,
    "furthest_seconds" INTEGER NOT NULL DEFAULT 0,
    "watched_seconds" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "last_watched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "video_playback_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_webhook_receipts" (
    "digest" VARCHAR(64) NOT NULL,
    "video_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_webhook_receipts_pkey" PRIMARY KEY ("digest")
);

-- CreateIndex
CREATE INDEX "video_playback_progress_video_id_idx" ON "video_playback_progress"("video_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_playback_progress_user_id_video_id_key" ON "video_playback_progress"("user_id", "video_id");

-- CreateIndex
CREATE INDEX "video_webhook_receipts_created_at_idx" ON "video_webhook_receipts"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "videos_provider_uid_key" ON "videos"("provider_uid");

-- AddForeignKey
ALTER TABLE "video_playback_progress" ADD CONSTRAINT "video_playback_progress_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_playback_progress" ADD CONSTRAINT "video_playback_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Server duration and position bounds also apply at API boundaries.
ALTER TABLE videos ADD CONSTRAINT video_completion_threshold CHECK (completion_percent BETWEEN 50 AND 100);
ALTER TABLE video_playback_progress ADD CONSTRAINT video_progress_nonnegative CHECK (position_seconds>=0 AND furthest_seconds>=0 AND watched_seconds>=0 AND version>=0);
CREATE INDEX video_processing_recovery ON videos(status,processing_lease) WHERE deleted_at IS NULL;
