ALTER TABLE "ai_providers" DROP CONSTRAINT IF EXISTS "ai_provider_type_check";
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_provider_type_check" CHECK ("type" IN ('openai','anthropic','gemini','openai-compatible','openrouter','workers-ai'));

