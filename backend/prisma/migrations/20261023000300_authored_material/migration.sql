-- Preserve the existing structured learning layout without exposing assessment keys.
ALTER TABLE "lessons" ADD COLUMN "learning_material" JSONB;
