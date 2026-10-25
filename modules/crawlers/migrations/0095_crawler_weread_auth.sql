CREATE TABLE crawler_weread_auth (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  credential_ref text NOT NULL DEFAULT 'crawler_credentials:weread',
  auth_status text NOT NULL DEFAULT 'missing' CHECK (auth_status IN ('missing', 'pending', 'valid', 'invalid', 'unknown')),
  validated_at timestamptz,
  active_login_id text,
  blocked_until timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
