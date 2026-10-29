import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import {
  diagnoseWereadSession, pollWereadLogin, startWereadLogin, wereadAuthView,
} from "../weread-auth.ts";
import { addWereadAccount, checkWereadAccount, previewWereadAccount, retryWereadBody } from "../weread.ts";
import { mpSourceRows } from "../registry.ts";
import { listFetchRuns } from "../runs.ts";

const BIZ = "MzIyMTAzMzU3OA==";
const BOOK_ID = "MP_WXS_3221033578";
const REVIEW_ID = `${BOOK_ID}_2_Oi~5o3nIX0N41~c1kOdw`;
const ARTICLE_URL = `https://mp.weixin.qq.com/s?__biz=${encodeURIComponent(BIZ)}&mid=100&idx=1`;
const INPUT = { articleUrl: ARTICLE_URL, participationMode: "editorial" as const, tier: "T2" as const, intervalMinutes: 60 };

let loginSucceed = false;
let shelfMode: "ok" | "invalid" | "http" = "ok";
let coverMode: "ok" | "auth" | "rate" = "ok";
let bodyFailures = 0;
let bodyCalls = 0;
let coverCalls = 0;
let sawSessionCookie = false;
let contentPublishedAt: number | null = null;

const provider = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://weread.test");
  const json = (status: number, value: unknown, cookies: string[] = []) => {
    res.writeHead(status, { "content-type": "application/json", ...(cookies.length ? { "set-cookie": cookies } : {}) });
    res.end(JSON.stringify(value));
  };
  if (req.headers.cookie?.includes("wr_skey=test-session-secret") || req.headers.cookie?.includes("wr_skey=renewed-secret")) sawSessionCookie = true;

  if (url.pathname === "/api/auth/getLoginUid") return json(200, { uid: "test-login-uid" }, ["wr_temp=temporary; Path=/; HttpOnly"]);
  if (url.pathname === "/api/auth/getLoginInfo") {
    if (!loginSucceed) return json(200, { errcode: "LOGIN_TIMEOUT" });
    return json(200, { succeed: true }, [
      "wr_vid=1234567890; Path=/; HttpOnly",
      "wr_skey=test-session-secret; Path=/; HttpOnly",
    ]);
  }
  if (url.pathname === "/web/shelf/sync") {
    if (shelfMode === "invalid") return json(200, { errcode: -2012 });
    if (shelfMode === "http") return json(503, { error: "busy" });
    return json(200, { books: [], synckey: 0 });
  }
  if (url.pathname === "/web/login/renewal") {
    if (shelfMode === "invalid") return json(200, { errcode: -2012 });
    return json(200, { succeed: true }, ["wr_skey=renewed-secret; Path=/; HttpOnly"]);
  }
  if (url.pathname === "/api/mp/cover") {
    coverCalls += 1;
    if (coverMode === "auth") return json(200, { errcode: -2012 });
    if (coverMode === "rate") return json(200, { errcode: -2041 });
    return json(200, { name: "迪fans", title: "比亚迪最新文章", reviewId: REVIEW_ID, pic: "https://mmbiz.qpic.cn/cover.jpg", avatar: "http://wx.qlogo.cn/account-avatar.jpg" });
  }
  if (url.pathname === "/web/mp/content") {
    bodyCalls += 1;
    if (bodyFailures > 0) {
      bodyFailures -= 1;
      return json(503, { error: "busy" });
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<html><body>${contentPublishedAt ? `<script>var oriCreateTime = '${contentPublishedAt}';</script>` : ""}<div id="js_content"><p>正文第一段</p><p>正文第二段</p><script>alert(1)</script></div></body></html>`);
  }
  return json(404, { error: "not found" });
});

before(async () => {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address() as { port: number };
  process.env.WEREAD_BASE_URL = `http://127.0.0.1:${address.port}`;
  config.allowPrivateNetworkFetch = true;
});

beforeEach(async () => {
  loginSucceed = false;
  shelfMode = "ok";
  coverMode = "ok";
  bodyFailures = 0;
  bodyCalls = 0;
  coverCalls = 0;
  sawSessionCookie = false;
  contentPublishedAt = null;
  await sql`DELETE FROM articles WHERE source_id = ${`mp-weread-3221033578`}`;
  await sql`DELETE FROM sources WHERE id = ${`mp-weread-3221033578`}`;
  await sql`DELETE FROM crawler_weread_logins`;
  await sql`DELETE FROM crawler_weread_auth`;
  await sql`DELETE FROM crawler_credentials WHERE collector = 'weread'`;
});

after(async () => {
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await stopBoss();
  await closeDb();
});

async function completeLogin(): Promise<void> {
  const flow = await startWereadLogin("test");
  loginSucceed = true;
  const result = await pollWereadLogin(flow.flowId, "test");
  assert.equal(result.status, "succeeded");
}

test("未授权可保存待验证账号；同一 bookId 不重复创建，授权恢复后继续验证", async () => {
  const added = await addWereadAccount(INPUT, "test");
  assert.equal(added.created, true);
  assert.equal(added.authRequired, true);
  assert.equal(added.status, "pending_validation");
  assert.equal((await sql`SELECT id FROM articles WHERE source_id = 'mp-weread-3221033578'`).length, 0);

  const duplicate = await addWereadAccount({ ...INPUT, articleUrl: `${ARTICLE_URL}&sn=another` }, "test");
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.duplicate?.sourceId, "mp-weread-3221033578");
  assert.equal((await sql`SELECT id FROM sources WHERE kind = 'mp_account' AND config ->> 'bookId' = ${BOOK_ID}`).length, 1);

  await completeLogin();
  const checked = await checkWereadAccount("mp-weread-3221033578", "manual");
  assert.equal(checked.status, "ok");
  const [account] = await sql<{ status: string; capability: string }[]>`SELECT status, capability FROM crawler_weread_accounts WHERE book_id = ${BOOK_ID}`;
  assert.deepEqual(account, { status: "active", capability: "latest_only" });
  const [article] = await sql<{ title: string; body_status: string; published_at: Date | null; discovered_at: Date }[]>`SELECT title, body_status, published_at, discovered_at FROM articles WHERE source_id = 'mp-weread-3221033578'`;
  assert.equal(article?.title, "比亚迪最新文章");
  assert.equal(article?.body_status, "ok");
  assert.equal(article?.published_at, null);
  assert.ok(article?.discovered_at instanceof Date);
});

test("真实扫码响应先验证书架再保存；公共状态和审计不泄露 Cookie", async () => {
  const flow = await startWereadLogin("test");
  assert.match(flow.qrSvg, /<svg/);
  const waiting = await pollWereadLogin(flow.flowId, "test");
  assert.equal(waiting.status, "pending");
  assert.equal((await wereadAuthView()).status, "pending");

  loginSucceed = true;
  const completed = await pollWereadLogin(flow.flowId, "test");
  assert.equal(completed.status, "succeeded");
  const auth = await wereadAuthView();
  assert.equal(auth.status, "valid");
  assert.equal(auth.loginPending, false);
  assert.ok(auth.maskedVid && !auth.maskedVid.includes("1234567890"));
  assert.equal(JSON.stringify(auth).includes("test-session-secret"), false);
  const audit = await sql`SELECT before, after FROM audit_log WHERE action LIKE 'crawler.weread%'`;
  assert.equal(JSON.stringify(audit).includes("test-session-secret"), false);
});

test("新扫码验证失败不覆盖已有可用会话，被替换的旧流程也不能完成", async () => {
  await completeLogin();
  const [before] = await sql<{ fields: unknown }[]>`SELECT fields FROM crawler_credentials WHERE collector = 'weread'`;
  const second = await startWereadLogin("test");
  shelfMode = "invalid";
  const failed = await pollWereadLogin(second.flowId, "test");
  assert.equal(failed.status, "failed");
  const [after] = await sql<{ fields: unknown }[]>`SELECT fields FROM crawler_credentials WHERE collector = 'weread'`;
  assert.deepEqual(after?.fields, before?.fields);
  assert.equal((await wereadAuthView()).status, "valid");

  shelfMode = "ok";
  const third = await startWereadLogin("test");
  const fourth = await startWereadLogin("test");
  const superseded = await pollWereadLogin(third.flowId, "test");
  assert.equal(superseded.status, "superseded");
  assert.ok(fourth.flowId);
});

test("相同 reviewId 不重复；正文失败保留元数据，自动重试和手动补读可恢复", async () => {
  await completeLogin();
  bodyFailures = 2;
  const added = await addWereadAccount(INPUT, "test");
  assert.equal(added.created, true);
  const [failed] = await sql<{ id: string; body_status: string; content_status: string }[]>`
    SELECT id, body_status, raw -> 'weread' ->> 'contentStatus' AS content_status FROM articles WHERE source_id = 'mp-weread-3221033578'`;
  assert.equal(failed?.body_status, "none");
  assert.equal(failed?.content_status, "failed");

  await checkWereadAccount("mp-weread-3221033578", "manual");
  assert.equal(bodyCalls, 2, "相同最新文章仍会补读未取得的正文");
  const retried = await retryWereadBody(failed!.id);
  assert.equal(retried.status, "ready");
  assert.equal(bodyCalls, 3);
  const articles = await sql<{ identity_key: string; body_status: string; revision: number; body_text: string | null }[]>`SELECT identity_key, body_status, revision, body_text FROM articles WHERE source_id = 'mp-weread-3221033578'`;
  assert.equal(articles.length, 1);
  assert.equal(articles[0]?.body_status, "ok");
  assert.equal(articles[0]?.revision, 2);
  assert.match(articles[0]?.body_text ?? "", /正文第一段/);

  const before = bodyCalls;
  const again = await checkWereadAccount("mp-weread-3221033578", "manual");
  assert.equal(again.created, 0);
  assert.equal(bodyCalls, before, "正文 ready 后不重复读取");
  const row = (await mpSourceRows()).find((item) => item.book_id === BOOK_ID);
  assert.equal(row?.runs[0]?.detail?.articleResult, "already_stored");
  assert.equal(row?.runs[0]?.detail?.contentResult, "already_ready");
});

test("正文带有原始发布时间时回写，并避免重复补查", async () => {
  await completeLogin();
  contentPublishedAt = Math.floor(Date.now() / 1000) - 3600;
  await addWereadAccount(INPUT, "test");
  const [article] = await sql<{ published_at: Date | null; checked_at: string | null }[]>`
    SELECT published_at, raw -> 'weread' ->> 'publishedAtCheckedAt' AS checked_at
    FROM articles WHERE source_id = 'mp-weread-3221033578'`;
  assert.equal(article?.published_at?.toISOString(), new Date(contentPublishedAt * 1000).toISOString());
  assert.ok(article?.checked_at);
  const before = bodyCalls;
  await checkWereadAccount("mp-weread-3221033578", "manual");
  assert.equal(bodyCalls, before, "已经取得发布时间后不再重复读取正文");
});

test("cover 受限不等于会话失效；认证异常和网络未知分别处理", async () => {
  await completeLogin();
  await addWereadAccount(INPUT, "test");
  coverMode = "rate";
  const limited = await checkWereadAccount("mp-weread-3221033578", "manual");
  assert.equal(limited.status, "failed");
  assert.equal(limited.errorCode, "rate_limited");
  const authAfterLimit = await wereadAuthView();
  assert.equal(authAfterLimit.status, "valid");
  assert.ok(authAfterLimit.blockedUntil && Date.parse(authAfterLimit.blockedUntil) > Date.now());
  const [account] = await sql<{ capability: string }[]>`SELECT capability FROM crawler_weread_accounts WHERE book_id = ${BOOK_ID}`;
  assert.equal(account?.capability, "blocked");

  await sql`UPDATE crawler_weread_auth SET blocked_until = NULL WHERE id = true`;
  coverMode = "auth";
  shelfMode = "invalid";
  const invalid = await checkWereadAccount("mp-weread-3221033578", "manual");
  assert.equal(invalid.status, "failed");
  assert.equal((await wereadAuthView()).status, "invalid");
  assert.equal((await sql`SELECT id FROM sources WHERE id = 'mp-weread-3221033578'`).length, 1, "会话失效不删除监测账号");
  assert.equal((await sql`SELECT id FROM articles WHERE source_id = 'mp-weread-3221033578'`).length, 1, "会话失效不删除文章");

  shelfMode = "http";
  const unknown = await diagnoseWereadSession("test");
  assert.equal(unknown.status, "unknown");
  assert.equal((await sql`SELECT collector FROM crawler_credentials WHERE collector = 'weread'`).length, 1, "无法判断时保留凭据");
});

test("公众号清单返回真实 WeRead 身份和文章状态", async () => {
  await completeLogin();
  await addWereadAccount(INPUT, "test");
  const preview = await previewWereadAccount(ARTICLE_URL);
  assert.equal(preview.duplicate?.sourceId, "mp-weread-3221033578");
  const row = (await mpSourceRows()).find((item) => item.book_id === BOOK_ID);
  assert.equal(row?.provider, "weread");
  assert.equal(row?.biz, BIZ);
  assert.equal(row?.capability, "latest_only");
  assert.equal(row?.icon, "http://wx.qlogo.cn/account-avatar.jpg");
  assert.equal(row?.articles[0]?.contentStatus, "ready");
  assert.equal(row?.articles[0]?.publishedAt, null);
  assert.equal(row?.runs[0]?.status, "ok");
  assert.equal(row?.runs[0]?.foundCount, 1);
  assert.equal(row?.runs[0]?.newCount, 1);
  assert.equal(row?.runs[0]?.detail?.contentStatus, "ready");
  assert.equal(row?.runs[0]?.detail?.articleResult, "created");
  assert.equal(row?.runs[0]?.detail?.contentResult, "fetched");
  assert.equal(row?.runs[0]?.detail?.title, "比亚迪最新文章");
  const logPage = await listFetchRuns("mp-weread-3221033578", 1);
  assert.equal(logPage?.source.name, "迪fans");
  assert.equal(logPage?.pageSize, 20);
  assert.equal(logPage?.total, 1);
  assert.equal(logPage?.runs[0]?.status, "ok");
  assert.equal(sawSessionCookie, true);
  assert.ok(coverCalls > 0);
});
