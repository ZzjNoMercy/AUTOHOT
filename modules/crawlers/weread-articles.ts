import * as cheerio from "cheerio";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { sanitizeBody } from "@aihot/backend/content/sanitize";
import { stripTags } from "@aihot/backend/lib/text";

const ARTICLE_HOST = "mp.weixin.qq.com";
const ARTICLE_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

export type ArticleResolveErrorCode = "invalid_url" | "invalid_biz" | "biz_missing" | "biz_conflict" | "verification_required" | "article_unavailable" | "article_fetch_failed" | "invalid_review_id" | "invalid_content";

export class WereadArticleError extends Error {
  readonly code: ArticleResolveErrorCode;
  readonly statusCode: number;

  constructor(code: ArticleResolveErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "WereadArticleError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ResolvedWechatArticle {
  articleUrl: string;
  biz: string;
  numericId: string;
  bookId: string;
  name: string | null;
  nameSource: "article" | null;
}

export function parseWechatArticleUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new WereadArticleError("invalid_url", "请输入有效的公众号文章链接");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== ARTICLE_HOST || (url.port && url.port !== "443") || url.username || url.password) {
    throw new WereadArticleError("invalid_url", "只接受 mp.weixin.qq.com 的官方 HTTPS 文章链接");
  }
  const short = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (url.pathname !== "/s" && url.pathname !== "/s/" && !short) {
    throw new WereadArticleError("invalid_url", "链接不是公众号文章地址（/s 或 /s/<token>）");
  }
  url.hash = "";
  return url;
}

export function decodeWechatBiz(input: string): { biz: string; numericId: string; bookId: string } {
  let value = input.trim();
  try {
    if (/%[0-9a-f]{2}/i.test(value)) value = decodeURIComponent(value);
  } catch {
    throw new WereadArticleError("invalid_biz", "__biz 的 URL 编码无效");
  }
  value = value.replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/");
  const unpadded = value.replace(/=+$/, "");
  if (!unpadded || unpadded.length % 4 === 1 || !/^[A-Za-z0-9+/]+$/.test(unpadded)) {
    throw new WereadArticleError("invalid_biz", "__biz 不是有效的 Base64 标识");
  }
  const padded = `${unpadded}${"=".repeat((4 - unpadded.length % 4) % 4)}`;
  const decoded = Buffer.from(padded, "base64");
  if (decoded.toString("base64").replace(/=+$/, "") !== unpadded) {
    throw new WereadArticleError("invalid_biz", "__biz 的 Base64 内容无效");
  }
  let numericId: string;
  try {
    numericId = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    throw new WereadArticleError("invalid_biz", "__biz 解码后不是文本标识");
  }
  if (!/^\d{1,20}$/.test(numericId) || /^0+$/.test(numericId)) {
    throw new WereadArticleError("invalid_biz", "__biz 解码后不是公众号数字标识");
  }
  return { biz: Buffer.from(numericId).toString("base64"), numericId, bookId: `MP_WXS_${numericId}` };
}

function articleName(html: string): string | null {
  const $ = cheerio.load(html);
  const meta = $("meta[property='og:article:author'], meta[name='author']").first().attr("content")?.trim();
  if (meta) return meta.slice(0, 200);
  const match = /(?:var\s+)?nickname\s*=\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/.exec(html);
  if (!match?.[2]) return null;
  const name = decodeJsString(match[2]).trim();
  return name ? name.slice(0, 200) : null;
}

export function bizFromArticleHtml(html: string): string {
  const candidates: string[] = [];
  const patterns = [
    /__biz=([^&\s"'<>}]+)/gi,
    /(?:^|[^\w])(?:__biz|msgBiz|msg_biz|biz)["']?\s*:\s*["']([^"']+)["']/g,
    /(?:^|[^\w])(?:__biz|msgBiz|msg_biz|biz)\s*=\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) if (match[1]) candidates.push(match[1]);
  }
  const resolved = new Map<string, string>();
  for (const candidate of candidates) {
    try {
      const { numericId } = decodeWechatBiz(candidate.replace(/&amp;.*$/i, ""));
      resolved.set(numericId, candidate);
    } catch {
      // A page can mention malformed examples; only a decoded, numeric id is evidence.
    }
  }
  if (resolved.size > 1) throw new WereadArticleError("biz_conflict", "文章页面包含不一致的公众号标识");
  if (resolved.size === 1) return [...resolved.values()][0]!;
  if (candidates.length) throw new WereadArticleError("invalid_biz", "文章中的 __biz 无法解析为数字标识");
  if (/环境异常|安全验证|完成验证|操作频繁|访问过于频繁|verify/i.test(html)) {
    throw new WereadArticleError("verification_required", "微信要求安全验证，暂时读不到这篇文章");
  }
  if (/内容已被发布者删除|此内容因违规无法查看|该内容已被删除|文章不存在|参数错误/.test(html)) {
    throw new WereadArticleError("article_unavailable", "文章已删除、不可见或地址已失效");
  }
  throw new WereadArticleError("biz_missing", "文章页面没有可确认的 __biz，未猜测账号标识");
}

async function officialArticleHtml(url: URL): Promise<{ html: string; finalUrl: URL }> {
  try {
    const res = await guardedFetch(url.toString(), {
      redirectPolicy: "same-origin",
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": ARTICLE_UA },
      timeoutMs: 25_000,
      maxBytes: 10 * 1024 * 1024,
    });
    const finalUrl = parseWechatArticleUrl(res.url);
    if (res.status < 200 || res.status >= 300) throw new WereadArticleError("article_unavailable", `文章页面返回 HTTP ${res.status}`, 422);
    return { html: res.text(), finalUrl };
  } catch (error) {
    if (error instanceof WereadArticleError) throw error;
    throw new WereadArticleError("article_fetch_failed", "暂时无法读取文章页面，请稍后重试", 422);
  }
}

export async function resolveWechatArticle(input: string, fetchHtml: (url: URL) => Promise<{ html: string; finalUrl: URL }> = officialArticleHtml): Promise<ResolvedWechatArticle> {
  const url = parseWechatArticleUrl(input);
  const direct = url.searchParams.getAll("__biz");
  if (direct.length > 1 && new Set(direct).size > 1) throw new WereadArticleError("biz_conflict", "链接包含多个不同的 __biz 参数");
  if (direct[0]) {
    return { articleUrl: url.toString(), ...decodeWechatBiz(direct[0]), name: null, nameSource: null };
  }
  if (url.pathname === "/s" || url.pathname === "/s/") throw new WereadArticleError("biz_missing", "长链接缺少 __biz 参数");
  const { html, finalUrl } = await fetchHtml(url);
  const redirectedBiz = finalUrl.searchParams.get("__biz");
  if (redirectedBiz) return { articleUrl: url.toString(), ...decodeWechatBiz(redirectedBiz), name: articleName(html), nameSource: "article" };
  const numericId = bizFromArticleHtml(html);
  return { articleUrl: url.toString(), ...decodeWechatBiz(numericId), name: articleName(html), nameSource: "article" };
}

export function wereadReviewUrl(reviewId: string, bookId: string): string {
  let token = reviewId.trim();
  const prefix = `${bookId}_`;
  if (prefix && token.startsWith(prefix)) token = token.slice(prefix.length);
  else if (token.includes("_")) token = token.split("_").at(-1)!;
  token = token.replace(/~/g, "_");
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) throw new WereadArticleError("invalid_review_id", "无法从 reviewId 还原原文短链");
  return `https://mp.weixin.qq.com/s/${encodeURIComponent(token)}`;
}

function decodeJsString(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (char !== "\\" || i + 1 >= input.length) {
      out += char;
      continue;
    }
    const next = input[i + 1]!;
    if (next === "x" && /^[0-9a-f]{2}$/i.test(input.slice(i + 2, i + 4))) {
      out += String.fromCharCode(Number.parseInt(input.slice(i + 2, i + 4), 16));
      i += 3;
    } else if (next === "u" && /^[0-9a-f]{4}$/i.test(input.slice(i + 2, i + 6))) {
      out += String.fromCharCode(Number.parseInt(input.slice(i + 2, i + 6), 16));
      i += 5;
    } else {
      const mapped: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'", '"': '"', "/": "/" };
      out += mapped[next] ?? next;
      i += 1;
    }
  }
  return out;
}

function contentNoencode(html: string): string {
  const match = /content_noencode\s*:\s*'((?:\\.|[^'\\])*)'/.exec(html);
  if (!match?.[1]) return "";
  return decodeJsString(match[1]).trim();
}

function canonicalUrl(html: string, $: cheerio.CheerioAPI): string | null {
  const meta = $("meta[property='og:url'], meta[name='og:url']").first().attr("content");
  const match = /var\s+msg_link\s*=\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/.exec(html);
  const candidate = (meta || (match?.[2] ? decodeJsString(match[2]) : "")).replace(/&amp;/g, "&").trim();
  if (!candidate) return null;
  try {
    return parseWechatArticleUrl(candidate).toString();
  } catch {
    return null;
  }
}

function originalPublishedAt(html: string, $: cheerio.CheerioAPI): Date | null {
  for (const name of ["oriCreateTime", "ct", "createTime", "publish_time", "msg_create_time"]) {
    const match = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d{10}|\\d{13})(?!\\d)`).exec(html);
    if (!match?.[1]) continue;
    const value = Number(match[1]);
    const date = new Date(match[1].length === 13 ? value : value * 1000);
    if (Number.isFinite(date.getTime())) return date;
  }
  const meta = $("meta[property='article:published_time'], meta[name='article:published_time'], meta[itemprop='datePublished']").first().attr("content");
  if (meta) {
    const time = Date.parse(meta);
    if (Number.isFinite(time)) return new Date(time);
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function extractWereadBody(html: string, baseUrl: string): { html: string; text: string; canonicalUrl: string | null; publishedAt: Date | null; plainTextFallback: boolean } {
  const $ = cheerio.load(html);
  const canonical = canonicalUrl(html, $);
  const publishedAt = originalPublishedAt(html, $);
  const content = $("#js_content").first().length ? $("#js_content").first() : $(".rich_media_content").first();
  content.find("script, style").remove();
  let inner = content.length ? content.html()?.trim() ?? "" : "";
  let plainTextFallback = false;
  if (!inner) {
    const text = contentNoencode(html);
    if (text) {
      inner = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
      plainTextFallback = true;
    }
  }
  if (!inner) throw new WereadArticleError("invalid_content", "响应中没有可确认的文章正文", 422);
  const cleaned = sanitizeBody(inner, baseUrl);
  const text = stripTags(cleaned.replace(/<\/p>|<br\s*\/?>/gi, "\n")).replace(/\n{3,}/g, "\n\n").trim();
  if (!text && !cleaned.includes("<img")) throw new WereadArticleError("invalid_content", "正文清洗后没有文字或图片", 422);
  return { html: cleaned, text, canonicalUrl: canonical, publishedAt, plainTextFallback };
}
