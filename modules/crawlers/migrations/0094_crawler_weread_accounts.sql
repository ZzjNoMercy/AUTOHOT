CREATE TABLE crawler_weread_accounts (
  source_id text PRIMARY KEY REFERENCES sources (id) ON DELETE CASCADE,
  book_id text NOT NULL UNIQUE,
  biz text NOT NULL,
  source_article_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending_validation' CHECK (status IN ('pending_validation', 'active')),
  capability text NOT NULL DEFAULT 'unknown' CHECK (capability IN ('unknown', 'latest_only', 'list_available', 'blocked')),
  validated_at timestamptz,
  last_seen_review_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
