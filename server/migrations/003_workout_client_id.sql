-- Idempotency key for workouts created offline and synced later. The client
-- generates a UUID when it starts an offline workout and sends it when it
-- uploads the finished workout; the server upserts by (user_id, client_id) so a
-- retried upload (ambiguous timeout, double tap) never creates a duplicate.
--
-- The index is PARTIAL (client_id IS NOT NULL): every workout created before
-- this feature — and every online workout, which has no client_id — stays
-- NULL and is exempt from the uniqueness constraint, so the index can be added
-- to an existing database without conflicts.

ALTER TABLE workouts ADD COLUMN client_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_user_client
  ON workouts(user_id, client_id)
  WHERE client_id IS NOT NULL;
