-- 财联社的话题订阅：选中的话题挂在 ext-cls 这条采集器源上；空表示按默认的 5 个话题抓。
ALTER TABLE crawler_sources ADD COLUMN IF NOT EXISTS topics jsonb;
