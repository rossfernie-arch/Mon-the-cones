-- Apply once to the existing production database before Worker v3 is deployed.
-- This migration preserves every existing score.
ALTER TABLE scores ADD COLUMN enemy_hits INTEGER NOT NULL DEFAULT 0 CHECK(enemy_hits >= 0);
ALTER TABLE scores ADD COLUMN gull_hits INTEGER NOT NULL DEFAULT 0 CHECK(gull_hits >= 0);
CREATE INDEX IF NOT EXISTS idx_scores_player_name ON scores(player_name);
