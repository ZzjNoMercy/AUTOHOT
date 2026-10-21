// 采集清单的数据路径：财联社话题存回 ext-cls 后能读出来；公众号清单读的是引擎的 mp_account 源。
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createSource } from "@aihot/backend/admin/sources";
import { closeDb, sql } from "@aihot/backend/db";
import { clsSource, mpSourceRows, registerCrawlerSource, saveClsTopics } from "../registry.ts";

const T = Date.now().toString(36);

after(() => closeDb());

test("财联社话题保存后按选中的读回；没保存过就是空（按默认五个抓）", async () => {
  await registerCrawlerSource({
    sourceId: "ext-cls", name: "财联社", collector: "cls", label: "财联社",
    tier: "T2", participationMode: "editorial", intervalMinutes: 60,
  }, "test");
  await sql`UPDATE crawler_sources SET topics = NULL WHERE source_id = 'ext-cls'`;
  assert.equal((await clsSource())?.topics, null, "还没选话题时按默认的抓");

  const topics = [{ id: "1090", name: "汽车大新闻" }, { id: "9999", name: "自定义话题" }];
  await saveClsTopics(topics, "test");
  assert.deepEqual((await clsSource())?.topics, topics, "选中的话题读回原样");

  const saved = await sql<{ actor: string; after: unknown }[]>`
    SELECT actor, after FROM audit_log WHERE action = 'crawler.topics' ORDER BY id DESC LIMIT 1`;
  assert.equal(saved[0]?.actor, "test");
  assert.deepEqual(saved[0]?.after, topics, "审计里留的是话题本身，没有凭据");
});

test("公众号清单读引擎的 mp_account 源和它的 ghid", async () => {
  const ghid = `gh_${T}`;
  const id = `mp-test-${T}`;
  const res = await createSource({
    id, name: "测试公众号", kind: "mp_account", config: { ghid, nickname: "测试公众号" },
  }, "test");
  assert.equal(res.created, true);

  const row = (await mpSourceRows()).find((s) => s.source_id === id);
  assert.deepEqual({ name: row?.name, ghid: row?.ghid }, { name: "测试公众号", ghid });
});
