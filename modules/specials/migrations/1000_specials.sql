-- Conference/series specials: a collection of independent stories, not one event.
CREATE TABLE specials (
  id bigserial PRIMARY KEY,
  public_id uuid NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  intro text,
  digest text,
  digest_updated_at timestamptz,
  starts_at date,
  ends_at date,
  cover_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
