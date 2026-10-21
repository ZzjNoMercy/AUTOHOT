-- 旧约束只允许 news/x，会挡住微博帖的写入；新约束（0087）已经生效。
ALTER TABLE publications DROP CONSTRAINT IF EXISTS publications_channel_check;
