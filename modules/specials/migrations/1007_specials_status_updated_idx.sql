CREATE INDEX CONCURRENTLY IF NOT EXISTS specials_status_updated_idx ON specials (status, updated_at DESC);
