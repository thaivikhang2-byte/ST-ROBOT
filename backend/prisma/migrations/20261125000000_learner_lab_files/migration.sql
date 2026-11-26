-- Additive, private learner attachments. Existing course snapshots and files
-- remain untouched. Chunk rows are deleted with their file/account.
CREATE TABLE "learner_lab_files" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "course_slug" VARCHAR(40) NOT NULL,
  "lesson_slug" VARCHAR(40) NOT NULL,
  "platform_key" VARCHAR(30) NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "chunk_count" INTEGER NOT NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'uploading',
  "client_upload_id" UUID NOT NULL,
  "upload_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learner_lab_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learner_lab_files_size_check" CHECK ("size_bytes" BETWEEN 0 AND 26214400),
  CONSTRAINT "learner_lab_files_chunks_check" CHECK ("chunk_count" = ("size_bytes" + 1048575) / 1048576),
  CONSTRAINT "learner_lab_files_status_check" CHECK ("status" IN ('uploading', 'ready')),
  CONSTRAINT "learner_lab_files_expiry_check" CHECK (("status" = 'uploading' AND "upload_expires_at" IS NOT NULL) OR ("status" = 'ready' AND "upload_expires_at" IS NULL)),
  CONSTRAINT "learner_lab_files_name_check" CHECK (length("name") > 0)
);
CREATE UNIQUE INDEX "learner_lab_files_user_id_client_upload_id_key" ON "learner_lab_files"("user_id", "client_upload_id");
CREATE INDEX "learner_lab_files_scope_idx" ON "learner_lab_files"("user_id", "course_slug", "lesson_slug", "platform_key", "status", "created_at");
CREATE INDEX "learner_lab_files_expiry_idx" ON "learner_lab_files"("user_id", "status", "upload_expires_at");
ALTER TABLE "learner_lab_files" ADD CONSTRAINT "learner_lab_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "learner_lab_file_chunks" (
  "file_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  CONSTRAINT "learner_lab_file_chunks_pkey" PRIMARY KEY ("file_id", "chunk_index"),
  CONSTRAINT "learner_lab_file_chunks_index_check" CHECK ("chunk_index" BETWEEN 0 AND 24),
  CONSTRAINT "learner_lab_file_chunks_size_check" CHECK ("size_bytes" BETWEEN 1 AND 1048576 AND octet_length("data") = "size_bytes")
);
ALTER TABLE "learner_lab_file_chunks" ADD CONSTRAINT "learner_lab_file_chunks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "learner_lab_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
