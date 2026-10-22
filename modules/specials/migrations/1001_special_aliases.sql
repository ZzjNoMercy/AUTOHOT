-- Names by which reports are matched to a special (the title itself is always one).
CREATE TABLE special_aliases (
  special_id bigint NOT NULL REFERENCES specials (id) ON DELETE CASCADE,
  alias text NOT NULL,
  PRIMARY KEY (special_id, alias)
);
