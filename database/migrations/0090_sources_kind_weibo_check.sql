-- 信源类型多一个 weibo：与 publications.channel 一样，先加一条 NOT VALID 约束，
-- 旧约束在下一个迁移里删除，最后一个迁移再验证。
ALTER TABLE sources ADD CONSTRAINT sources_kind_weibo_check CHECK (kind = ANY (ARRAY['rss', 'web_list', 'json_list', 'x_search', 'weibo', 'mp_account', 'external'])) NOT VALID;
