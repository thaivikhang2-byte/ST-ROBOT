-- Creating the index first aborts on historical case/whitespace collisions without deleting accounts.
-- Resolve collisions explicitly before retrying this migration; never merge accounts automatically.
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users" (lower(btrim("email")));
UPDATE "users" SET "email" = lower(btrim("email"));
ALTER TABLE "credential_tokens" ADD CONSTRAINT "credential_tokens_purpose_check" CHECK ("purpose" IN ('reset', 'verify'));
