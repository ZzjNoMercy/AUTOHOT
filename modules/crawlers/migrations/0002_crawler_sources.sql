-- 哪些信源归哪个采集器管：external 源的 config 有白名单，放不下这个标记，所以模块自己记一份。
CREATE TABLE crawler_sources (
  source_id   text PRIMARY KEY REFERENCES sources (id) ON DELETE CASCADE,
  collector   text NOT NULL,
  account     text,
  label       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
