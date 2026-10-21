-- 已有行都是 news/x，验证不会失败；这一步只做一次全表扫描。
ALTER TABLE publications VALIDATE CONSTRAINT publications_channel_weibo_check;
