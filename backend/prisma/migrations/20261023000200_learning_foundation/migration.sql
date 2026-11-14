-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "content_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "is_required" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "available_from" TIMESTAMP(3),
ADD COLUMN     "available_until" TIMESTAMP(3),
ADD COLUMN     "requires_pass" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "review_answers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "quiz_questions" ADD COLUMN     "accepted_answers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "case_sensitive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "grading_rubric" TEXT,
ALTER COLUMN "points" SET DEFAULT 1,
ALTER COLUMN "points" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "quiz_attempts" ADD COLUMN     "deadline_at" TIMESTAMP(3),
ADD COLUMN     "graded_at" TIMESTAMP(3),
ADD COLUMN     "quiz_revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "status" VARCHAR(30) NOT NULL DEFAULT 'in_progress',
ADD COLUMN     "submission_hash" VARCHAR(64),
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ALTER COLUMN "score" DROP NOT NULL,
ALTER COLUMN "score" DROP DEFAULT,
ALTER COLUMN "score" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "max_score" SET DEFAULT 0,
ALTER COLUMN "max_score" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "percentage" DROP NOT NULL,
ALTER COLUMN "percentage" DROP DEFAULT,
ALTER COLUMN "is_passed" DROP NOT NULL,
ALTER COLUMN "is_passed" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quiz_attempt_answers" ADD COLUMN     "feedback" TEXT,
ADD COLUMN     "graded_at" TIMESTAMP(3),
ADD COLUMN     "graded_by" UUID,
ALTER COLUMN "is_correct" DROP NOT NULL,
ALTER COLUMN "is_correct" DROP DEFAULT,
ALTER COLUMN "points" DROP NOT NULL,
ALTER COLUMN "points" DROP DEFAULT,
ALTER COLUMN "points" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "completed_version" INTEGER,
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "progress" ADD COLUMN     "last_accessed_at" TIMESTAMP(3),
ADD COLUMN     "started_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "lab_resources" (
    "id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "platform" VARCHAR(30) NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "embed_policy" VARCHAR(20) NOT NULL DEFAULT 'external',
    "instructions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practical_submissions" (
    "id" UUID NOT NULL,
    "lab_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_url" VARCHAR(2000) NOT NULL,
    "notes" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'submitted',
    "feedback" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practical_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_resources_lesson_id_deleted_at_idx" ON "lab_resources"("lesson_id", "deleted_at");

-- CreateIndex
CREATE INDEX "practical_submissions_user_id_created_at_idx" ON "practical_submissions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "practical_submissions_lab_id_status_idx" ON "practical_submissions"("lab_id", "status");

-- CreateIndex
CREATE INDEX "quiz_attempts_user_id_quiz_id_status_idx" ON "quiz_attempts"("user_id", "quiz_id", "status");

-- CreateIndex
CREATE INDEX "quiz_attempts_status_deadline_at_idx" ON "quiz_attempts"("status", "deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempt_answers_attempt_id_question_id_key" ON "quiz_attempt_answers"("attempt_id", "question_id");

-- AddForeignKey
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_resources" ADD CONSTRAINT "lab_resources_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practical_submissions" ADD CONSTRAINT "practical_submissions_lab_id_fkey" FOREIGN KEY ("lab_id") REFERENCES "lab_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practical_submissions" ADD CONSTRAINT "practical_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practical_submissions" ADD CONSTRAINT "practical_submissions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve existing finalized scores. Legacy active attempts have no authoritative
-- snapshot, so they expire rather than silently adopting current question definitions.
UPDATE "quiz_attempts" SET "status" = CASE WHEN "finished_at" IS NOT NULL THEN 'graded' ELSE 'expired' END,
  "submitted_at" = "finished_at", "graded_at" = "finished_at";
UPDATE "enrollments" SET "status" = 'cancelled' WHERE "deleted_at" IS NOT NULL;
UPDATE "progress" SET "started_at" = "created_at", "last_accessed_at" = "updated_at";

CREATE UNIQUE INDEX "quiz_attempt_one_active" ON "quiz_attempts" ("user_id", "quiz_id") WHERE "status" = 'in_progress';
ALTER TABLE "quizzes" ADD CONSTRAINT "quiz_configuration_valid" CHECK (
  pass_score BETWEEN 0 AND 100 AND max_attempts >= 0 AND (time_limit IS NULL OR time_limit > 0)
  AND status IN ('draft', 'published', 'archived') AND revision > 0
  AND (available_from IS NULL OR available_until IS NULL OR available_from < available_until)
);
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempt_state_valid" CHECK (
  status IN ('in_progress', 'pending_grading', 'graded', 'expired')
);
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollment_state_valid" CHECK (status IN ('active', 'cancelled'));
ALTER TABLE "progress" ADD CONSTRAINT "progress_state_valid" CHECK (status IN ('not_started', 'in_progress', 'completed'));
ALTER TABLE "lab_resources" ADD CONSTRAINT "lab_external_only" CHECK (embed_policy = 'external');
ALTER TABLE "practical_submissions" ADD CONSTRAINT "practical_submission_state_valid" CHECK (status IN ('submitted', 'completed', 'needs_revision'));
