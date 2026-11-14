-- Preserve existing, unverified legacy objects; only newly verified uploads are deliverable.
ALTER TABLE "storage_objects"
  ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'legacy',
  ADD COLUMN "staging_key" VARCHAR(500),
  ADD COLUMN "upload_expires_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "staging_deleted_at" TIMESTAMP(3),
  ADD COLUMN "purged_at" TIMESTAMP(3),
  ADD COLUMN "scan_status" VARCHAR(20) NOT NULL DEFAULT 'not_scanned';
ALTER TABLE "storage_objects" ALTER COLUMN "status" SET DEFAULT 'pending';
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_status_check"
  CHECK ("status" IN ('legacy','pending','uploading','verifying','ready','failed','deleted'));
CREATE INDEX "storage_objects_status_upload_expires_at_idx" ON "storage_objects"("status","upload_expires_at");
CREATE TABLE "lesson_media" (
  "id" UUID NOT NULL,
  "lesson_id" UUID NOT NULL,
  "storage_object_id" UUID NOT NULL,
  "resource_type" VARCHAR(20) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lesson_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lesson_media_type_check" CHECK ("resource_type" IN ('image','document','video','download')),
  CONSTRAINT "lesson_media_order_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "lesson_media_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lesson_media_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lesson_media_storage_object_id_key" ON "lesson_media"("storage_object_id");
CREATE INDEX "lesson_media_lesson_id_sort_order_idx" ON "lesson_media"("lesson_id","sort_order");
ALTER TABLE "videos" ADD COLUMN "storage_object_id" UUID;
CREATE UNIQUE INDEX "videos_storage_object_id_key" ON "videos"("storage_object_id");
ALTER TABLE "videos" ADD CONSTRAINT "videos_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
