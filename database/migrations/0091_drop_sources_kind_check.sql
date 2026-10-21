-- 旧约束不接受 weibo；新约束（0090）已经生效。
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_kind_check;
