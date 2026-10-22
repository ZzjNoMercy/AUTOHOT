-- Generated overviews; a saved version stands while its member set still hashes the same.
CREATE TABLE special_digests (
  special_id bigint NOT NULL REFERENCES specials (id) ON DELETE CASCADE,
  version integer NOT NULL,
  digest text NOT NULL,
  input_hash text NOT NULL,
  article_ids text[] NOT NULL DEFAULT '{}',
  receipt_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (special_id, version)
);
