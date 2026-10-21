-- 已有行的类型都在新约束里，验证只做一次全表扫描。
ALTER TABLE sources VALIDATE CONSTRAINT sources_kind_weibo_check;
