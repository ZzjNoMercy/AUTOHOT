-- Reports in a special. A report may belong to more than one special (a conference and a company series).
CREATE TABLE special_reports (
  special_id bigint NOT NULL REFERENCES specials (id) ON DELETE CASCADE,
  article_id text NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  confidence numeric(4, 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (special_id, article_id)
);
