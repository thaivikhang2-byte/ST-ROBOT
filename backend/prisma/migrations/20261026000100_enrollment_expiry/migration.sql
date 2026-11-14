-- Existing enrollments have no expiry; only explicit future policies set this field.
ALTER TABLE "enrollments" ADD COLUMN "expires_at" TIMESTAMP(3);
