-- Candidates an editor chose not to create; they stay out of the suggestion list.
CREATE TABLE special_ignored_candidates (
  candidate_key text PRIMARY KEY,
  ignored_at timestamptz NOT NULL DEFAULT now()
);
