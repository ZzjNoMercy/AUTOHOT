-- 微博帖也可以上公开列表：先把 channel 的新取值加进一条 NOT VALID 约束（不扫描已有行），
-- 旧约束在下一个迁移里删除，最后一个迁移再验证这条。
ALTER TABLE publications ADD CONSTRAINT publications_channel_weibo_check CHECK (channel = ANY (ARRAY['news', 'x', 'weibo'])) NOT VALID;
