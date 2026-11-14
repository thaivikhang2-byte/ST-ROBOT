ALTER TABLE "ai_memory_entries" DROP CONSTRAINT "ai_memory_entries_proposal_id_fkey";
ALTER TABLE "ai_memory_entries"
  ADD CONSTRAINT "ai_memory_entries_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "ai_memory_proposals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
