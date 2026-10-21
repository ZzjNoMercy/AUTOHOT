-- 手动填的账号头像（URL）。空表示用采集器自动取到的头像：采集时写进 sources.icon_url。
ALTER TABLE crawler_sources ADD COLUMN IF NOT EXISTS icon_url text;
