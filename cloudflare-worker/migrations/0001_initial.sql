-- New installations only. Existing production data must not be dropped.
CREATE TABLE IF NOT EXISTS scores (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 run_id TEXT NOT NULL UNIQUE,
 player_id TEXT NOT NULL,
 player_name TEXT NOT NULL CHECK(length(player_name) BETWEEN 1 AND 7 AND player_name NOT GLOB '*[^A-Za-z0-9]*'),
 mode TEXT NOT NULL CHECK(mode IN ('adventure','campaign')),
 level INTEGER CHECK(level IS NULL OR level BETWEEN 1 AND 5),
 score INTEGER NOT NULL CHECK(score >= 0),
 distance INTEGER NOT NULL DEFAULT 0 CHECK(distance >= 0),
 cones INTEGER NOT NULL DEFAULT 0 CHECK(cones >= 0),
 duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms >= 0),
 prize_mask INTEGER NOT NULL DEFAULT 0 CHECK(prize_mask BETWEEN 0 AND 7),
 enemy_hits INTEGER NOT NULL DEFAULT 0 CHECK(enemy_hits >= 0),
 gull_hits INTEGER NOT NULL DEFAULT 0 CHECK(gull_hits >= 0),
 build_version TEXT NOT NULL DEFAULT 'unknown',
 ended_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scores_mode_score ON scores(mode,score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_mode_distance ON scores(mode,distance DESC);
CREATE INDEX IF NOT EXISTS idx_scores_campaign ON scores(mode,level,duration_ms ASC);
CREATE INDEX IF NOT EXISTS idx_scores_player_name ON scores(player_name);
