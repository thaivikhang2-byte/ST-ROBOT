-- Existing identities retain their current status; only new requests await approval.
ALTER TABLE "users" ADD COLUMN "student_approval_pending" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "users_student_approval_pending_created_at_idx"
    ON "users"("student_approval_pending", "created_at");
