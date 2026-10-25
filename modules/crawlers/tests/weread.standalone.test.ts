import assert from "node:assert/strict";
import { test } from "node:test";
import { absorbSetCookie } from "../weread-client.ts";
import {
  bizFromArticleHtml, decodeWechatBiz, extractWereadBody, parseWechatArticleUrl,
  resolveWechatArticle, wereadReviewUrl,
} from "../weread-articles.ts";

const BIZ = "MzIyMTAzMzU3OA==";
const BOOK_ID = "MP_WXS_3221033578";

test("迪fans 长链接直接解析为 MP_WXS_3221033578，不请求文章页面", async () => {
  const result = await resolveWechatArticle(`https://mp.weixin.qq.com/s?__biz=${encodeURIComponent(BIZ)}&mid=100000&idx=1`, async () => {
    throw new Error("should not fetch");
  });
  assert.equal(result.bookId, BOOK_ID);
  assert.equal(result.numericId, "3221033578");
  assert.equal(result.biz, BIZ);
  assert.deepEqual(decodeWechatBiz("MzIyMTAzMzU3OA%3D%3D"), { biz: BIZ, numericId: "3221033578", bookId: BOOK_ID });
});

test("短链从 HTML 和页面变量提取同一个 biz，并保留文章来源名称", async () => {
  const url = "https://mp.weixin.qq.com/s/2_Oi_5o3nIX0N41_c1kOdw";
  const fromVariable = await resolveWechatArticle(url, async (input) => ({
    finalUrl: input,
    html: `<html><script>var biz = "${BIZ}"; var nickname = "迪fans";</script></html>`,
  }));
  assert.equal(fromVariable.bookId, BOOK_ID);
  assert.equal(fromVariable.name, "迪fans");
  assert.equal(fromVariable.nameSource, "article");

  const fromLink = await resolveWechatArticle(url, async (input) => ({
    finalUrl: input,
    html: `<html><a href="?__biz=${encodeURIComponent(BIZ)}&amp;mid=1">link</a></html>`,
  }));
  assert.equal(fromLink.bookId, BOOK_ID);
});

test("非法域名、非文章路径和错误 Base64 不会变成采集账号", async () => {
  for (const url of [
    "http://mp.weixin.qq.com/s/abc",
    "https://example.com/s/abc",
    "https://user:pass@mp.weixin.qq.com/s/abc",
    "https://mp.weixin.qq.com/cgi-bin/searchbiz?query=x",
  ]) assert.throws(() => parseWechatArticleUrl(url), { code: "invalid_url" });
  await assert.rejects(resolveWechatArticle("https://mp.weixin.qq.com/s?__biz=not-base64"), { code: "invalid_biz" });
  await assert.rejects(resolveWechatArticle("https://mp.weixin.qq.com/s/abc", async (input) => ({ finalUrl: input, html: "<p>环境异常，请完成安全验证</p>" })), { code: "verification_required" });
  await assert.rejects(resolveWechatArticle("https://mp.weixin.qq.com/s/abc", async (input) => ({ finalUrl: input, html: "<p>没有字段</p>" })), { code: "biz_missing" });
});

test("页面中冲突的数字标识会失败，而不是任选一个", () => {
  const other = Buffer.from("123456").toString("base64");
  assert.throws(() => bizFromArticleHtml(`<script>var biz="${BIZ}"; var other="__biz=${other}";</script>`), { code: "biz_conflict" });
});

test("reviewId 只在构造原文链接时还原波浪线，原标识不变", () => {
  const reviewId = `${BOOK_ID}_2_Oi~5o3nIX0N41~c1kOdw`;
  assert.equal(wereadReviewUrl(reviewId, BOOK_ID), "https://mp.weixin.qq.com/s/2_Oi_5o3nIX0N41_c1kOdw");
  assert.equal(reviewId, `${BOOK_ID}_2_Oi~5o3nIX0N41~c1kOdw`);
});

test("正文节点清除脚本并保留图片，canonical 只接受官方文章地址", () => {
  const body = extractWereadBody(`<html><head><meta property="og:url" content="https://mp.weixin.qq.com/s?__biz=${BIZ}&amp;mid=42"></head><body><div id="js_content"><p>第一段</p><script>alert(1)</script><img data-src="https://mmbiz.qpic.cn/pic.jpg"></div></body></html>`, "https://mp.weixin.qq.com/s/test");
  assert.match(body.text, /第一段/);
  assert.doesNotMatch(body.text, /alert/);
  assert.match(body.html, /<img[^>]+src="https:\/\/mmbiz.qpic.cn\/pic.jpg"/);
  assert.equal(body.canonicalUrl, `https://mp.weixin.qq.com/s?__biz=${BIZ}&mid=42`);
  assert.equal(body.publishedAt, null);
  assert.equal(body.plainTextFallback, false);
});

test("从原始页面变量读取真实发布时间，不使用抓取时间", () => {
  const timestamp = 1792816207;
  const body = extractWereadBody(`<html><body><script>var oriCreateTime = '${timestamp}'; var ct = "${timestamp}";</script><div id="js_content"><p>正文</p></div></body></html>`, "https://mp.weixin.qq.com/s/test");
  assert.equal(body.publishedAt?.toISOString(), new Date(timestamp * 1000).toISOString());
});

test("content_noencode 只作为纯文本兜底，并明确标记富文本降级", () => {
  const body = extractWereadBody(`<html><script>var share = {content_noencode: '第一段\\x0a第二段\\'引用'};</script></html>`, "https://mp.weixin.qq.com/s/test");
  assert.equal(body.text, "第一段 第二段'引用");
  assert.equal(body.plainTextFallback, true);
  assert.throws(() => extractWereadBody("<html><body>验证页面</body></html>", "https://mp.weixin.qq.com/s/test"), { code: "invalid_content" });
});

test("Cookie jar 合并服务端更新并删除失效项", () => {
  const jar: Record<string, string> = { wr_vid: "old", wr_skey: "secret", other: "keep" };
  absorbSetCookie(jar, [
    "wr_vid=new; Path=/; HttpOnly",
    "wr_skey=; Max-Age=0; Path=/",
    "fresh=value; Path=/",
  ]);
  assert.deepEqual(jar, { wr_vid: "new", other: "keep", fresh: "value" });
});
