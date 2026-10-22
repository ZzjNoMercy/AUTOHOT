-- An editor removed this report from the special; automatic matching must not put it back.
CREATE TABLE special_exclusions (
  special_id bigint NOT NULL REFERENCES specials (id) ON DELETE CASCADE,
  article_id text NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (special_id, article_id)
);
