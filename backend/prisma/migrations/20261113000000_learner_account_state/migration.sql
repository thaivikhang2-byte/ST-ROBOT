-- Additive account sync storage. No existing user, content or progress rows are changed.
CREATE TABLE "learner_states" (
  "user_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "values" JSONB NOT NULL,
  "summary" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learner_states_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "learner_states_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "learner_states_values_object_check" CHECK (jsonb_typeof("values") = 'object'),
  CONSTRAINT "learner_states_summary_object_check" CHECK (jsonb_typeof("summary") = 'object')
);
CREATE INDEX "learner_states_updated_at_idx" ON "learner_states"("updated_at");
ALTER TABLE "learner_states" ADD CONSTRAINT "learner_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
