-- 采集器的凭据（微博的 cookie / XSRF token 等）：后台「采集器」页可以随时更新，不必改 .env 重启容器。
-- 会过期的登录态放在这里；不进 git。
CREATE TABLE crawler_credentials (
  collector   text PRIMARY KEY,
  fields      jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
