// 采集清单的数据路径：财联社话题存回 ext-cls 后能读出来；公众号清单读的是引擎的 mp_account 源。
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createSource } from "@aihot/backend/admin/sources";
import { closeDb, sql } from "@aihot/backend/db";
import { saveCredentials } from "../credentials.ts";
import { clsSource, mpSourceRows, registerCrawlerSource, saveClsTopics } from "../registry.ts";
import { collectWeibo, testWeiboCredentials } from "../weibo.ts";

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

test("微博登录态测试使用已保存的凭据，只读第一页并返回读取条数", async () => {
  await saveCredentials("weibo", { cookie: "test-cookie", xsrfToken: "test-xsrf" }, "test");
  const requests: Array<{ url: URL; headers: Record<string, string> }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: new URL(String(input)), headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify({ data: { list: [{ mblogid: "one" }, { mblogid: "two" }] } }), { status: 200 });
  };
  const result = await testWeiboCredentials("123456789", fetcher);
  assert.deepEqual(result, { ok: true, count: 2 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url.searchParams.get("uid"), "123456789");
  assert.equal(requests[0]!.url.searchParams.get("page"), "1");
  assert.equal(requests[0]!.url.searchParams.get("since_id"), null);
  assert.equal(requests[0]!.headers.cookie, "test-cookie");
  assert.equal(requests[0]!.headers["x-xsrf-token"], "test-xsrf");
  const [stored] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM articles WHERE url LIKE 'https://weibo.com/%'`;
  assert.equal(stored!.count, 0, "测试登录态不写入文章");
});

test("微博登录态测试把微博返回的异常结构报告为失败", async () => {
  await saveCredentials("weibo", { cookie: "updated-cookie", xsrfToken: "updated-xsrf" }, "test");
  let calls = 0;
  const result = await testWeiboCredentials("123456789", async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: 0, error: "login required" }), { status: 200 });
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /data\.list/);
  assert.equal(calls, 1);
});

test("微博第二页继续使用第一页返回的 since_id", async () => {
  await saveCredentials("weibo", { cookie: "test-cookie", xsrfToken: "test-xsrf" }, "test");
  const urls: URL[] = [];
  const result = await collectWeibo("123456789", async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    return new Response(JSON.stringify({ data: { list: [], ...(url.searchParams.get("page") === "1" ? { since_id: "next=1" } : {}) } }), { status: 200 });
  });
  assert.deepEqual(result, { items: [], avatar: null });
  assert.equal(urls.length, 2);
  assert.equal(urls[0]!.searchParams.get("since_id"), null);
  assert.equal(urls[1]!.searchParams.get("page"), "2");
  assert.equal(urls[1]!.searchParams.get("since_id"), "next=1");
});
