CREATE TABLE crawler_weread_logins (
  id text PRIMARY KEY,
  uid text NOT NULL,
  cookies jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'expired', 'failed', 'superseded')),
  expires_at timestamptz NOT NULL,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
