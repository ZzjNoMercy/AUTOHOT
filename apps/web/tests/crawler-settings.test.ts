import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { startWebServer, type WebServer } from "./web-server.ts";

let web: WebServer;
let browser: Browser;
let failed = false;
let testCalls = 0;
const saves: unknown[] = [];

async function body(req: import("node:http").IncomingMessage) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return JSON.parse(text || "{}") as unknown;
}

const api = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://api.local");
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/api/admin/me") return res.end(JSON.stringify({ name: "测试管理员", csrf: "fixture", dev: true }));
  if (url.pathname === "/api/admin/nav-counts") return res.end(JSON.stringify({ sources: 0 }));
  if (url.pathname === "/api/admin/settings") {
    return res.end(JSON.stringify({
      contact: { wechatQr: null, feishuQr: null }, providers: [], targets: [], budgets: [],
      modules: {
        crawlers: {
          weibo: { saved: true, from: "admin", updatedAt: "2026-10-26T06:00:00.000Z", updatedBy: "测试管理员", masked: { cookie: "…1234", xsrfToken: "…token" } },
          weread: { status: "missing", validatedAt: null, lastErrorCode: null, blockedUntil: null, loginPending: false, maskedVid: null },
        },
      },
    }));
  }
  if (url.pathname === "/api/admin/crawlers/weibo/test" && req.method === "POST") {
    assert.deepEqual(await body(req), {});
    testCalls += 1;
    return res.end(JSON.stringify(failed ? { ok: false, error: "微博 HTTP 403：请更新 cookie" } : { ok: true, count: 21 }));
  }
  if (url.pathname === "/api/admin/crawlers/credentials" && req.method === "POST") {
    saves.push(await body(req));
    return res.end(JSON.stringify({ ok: true }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ detail: "not_found" }));
});

before(async () => {
  web = await startWebServer(api);
  browser = await chromium.launch({ channel: "chromium" });
});

after(async () => {
  await browser?.close();
  await web?.stop();
});

test("微博登录态测试显示结果和失败原因，保存新凭据后清除旧结论", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(`${web.origin}/admin/settings`);
    const check = page.getByRole("button", { name: "测试登录态", exact: true });
    const result = page.getByRole("status").filter({ hasText: /^(刚刚取到|测试未通过)/ });
    await expect(check).toBeVisible();
    await check.click();
    await expect(result).toHaveText("刚刚取到 21 条，登录态有效");

    failed = true;
    await check.click();
    await expect(result).toHaveText("测试未通过：微博 HTTP 403：请更新 cookie");
    failed = false;
    await check.click();
    await expect(result).toHaveText("刚刚取到 21 条，登录态有效");
    assert.equal(testCalls, 3);

    await page.getByRole("textbox", { name: /^cookie(?:\s|$)/ }).fill("new-cookie");
    await page.getByRole("textbox", { name: /^XSRF token(?:\s|$)/ }).fill("new-token");
    await page.getByRole("button", { name: "保存登录态", exact: true }).click();
    await expect(page.getByText("已保存，请测试确认登录态是否有效", { exact: true })).toBeVisible();
    await expect(page.getByText("刚刚取到 21 条，登录态有效", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /^cookie(?:\s|$)/ })).toHaveValue("");
    await expect(page.getByRole("textbox", { name: /^XSRF token(?:\s|$)/ })).toHaveValue("");
    assert.deepEqual(saves, [{ collector: "weibo", fields: { cookie: "new-cookie", xsrfToken: "new-token" } }]);
  } finally {
    failed = false;
    await context.close();
  }
});
