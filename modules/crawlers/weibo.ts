// 微博：登录态（cookie + XSRF token）在后台「设置 → 采集凭据」里更新，每个账号一个信源。
// 正文来自接口本身（折叠的长文再取一次 longtext），不抓原文页。
import { getCredentials } from "./credentials.ts";
import type { CollectResult, CrawledItem } from "./types.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

interface WeiboPost {
  mblogid?: string;
  created_at?: string;
  text?: string;
  text_raw?: string;
  isTop?: number | string;
  title?: { text?: string } | null;
  user?: { screen_name?: string; avatar_hd?: string; avatar_large?: string; profile_image_url?: string } | null;
}

/**
 * 头像地址里有一段决定尺寸（…/crop.0.0.599.599.1024/…），列表里的头像只有 96px，
 * 取 180 的版本，别每次都让图片代理去下 1024。
 * 登录态下拿到的是带 Expires/ssig 的签名地址（三小时就过期），去掉查询串后公开可读，存这个。
 */
export function avatarOf(post: WeiboPost): string | null {
  const raw = String(post.user?.avatar_hd ?? post.user?.avatar_large ?? post.user?.profile_image_url ?? "").trim();
  const path = raw.split("?")[0] ?? "";
  if (!/^https?:\/\//i.test(path)) return null;
  return path.replace(/(\/crop\.[\d.]+\.)\d+(\/)/, (_m, head: string, tail: string) => `${head}180${tail}`);
}

/** 微博的时间形如 "Wed Oct 18 15:00:00 +0800 2026"：年份在最后，月份是英文缩写，时区带在中间。 */
export function parseCreatedAt(value: unknown): Date | null {
  const m = /^\w{3} (\w{3}) (\d{1,2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4}) (\d{4})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const month = MONTHS[m[1]!];
  if (!month) return null;
  const offset = m[4]!;
  const at = new Date(`${m[5]}-${month}-${m[2]!.padStart(2, "0")}T${m[3]}${offset.slice(0, 3)}:${offset.slice(3)}`);
  return Number.isFinite(at.getTime()) ? at : null;
}

function headersFor(uid: string, credentials: Record<string, string>) {
  return {
    "user-agent": UA,
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9",
    "x-requested-with": "XMLHttpRequest",
    "x-xsrf-token": credentials.xsrfToken!,
    cookie: credentials.cookie!,
    referer: `https://weibo.com/u/${uid}`,
  };
}

/** 折叠的长文：正文只给了前半段，再取一次 longtext。取不到就用 text_raw。 */
async function longText(mblogid: string, headers: ReturnType<typeof headersFor>, fallback: string): Promise<string> {
  try {
    const res = await fetch(`https://weibo.com/ajax/statuses/longtext?id=${mblogid}`, { headers, signal: AbortSignal.timeout(15_000) });
    const json = (await res.json()) as { data?: { longTextContent?: string } };
    const text = json.data?.longTextContent;
    return typeof text === "string" && text.trim() ? text.trim() : fallback;
  } catch {
    return fallback;
  }
}

async function toItem(post: WeiboPost, uid: string, headers: ReturnType<typeof headersFor>): Promise<CrawledItem | null> {
  if (Number(post.isTop ?? 0) === 1) return null; // 置顶帖不算新内容
  if (post.title?.text) return null; // 头条文章，原脚本也跳过
  const mblogid = post.mblogid;
  const raw = String(post.text_raw ?? "").trim();
  if (!mblogid || !raw) return null;
  const body = String(post.text ?? "").includes("展开</span>") ? await longText(mblogid, headers, raw) : raw;
  const clean = body.replace(/[\u0000-\u001F\u007F-\u009F\u2000-\u200F\u2028-\u202F]/g, "");
  const firstLine = clean.split("\n").map((l) => l.trim()).find(Boolean) ?? clean;
  return {
    url: `https://weibo.com/${uid}/${mblogid}`,
    title: firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine,
    bodyText: clean,
    publishedAt: parseCreatedAt(post.created_at),
    author: post.user?.screen_name ?? null,
  };
}

/** 一个账号的前两页（原脚本的口径），置顶和头条文章跳过。头像一起带回来，页面上给账号显示。 */
export async function collectWeibo(uid: string): Promise<CollectResult> {
  const credentials = await getCredentials("weibo");
  if (!credentials?.cookie?.trim() || !credentials?.xsrfToken?.trim()) {
    throw new Error("微博登录态未设置：到后台「设置 → 采集凭据」填 cookie 和 XSRF token");
  }
  const headers = headersFor(uid, credentials);
  const out: CrawledItem[] = [];
  let avatar: string | null = null;
  let sinceId: string | undefined;
  for (const page of ["1", "2"]) {
    const params = new URLSearchParams({ uid, page, feature: "0", ...(sinceId ? { since_id: sinceId } : {}) });
    const res = await fetch(`https://weibo.com/ajax/statuses/mymblog?${params}`, { headers, signal: AbortSignal.timeout(20_000) });
    if (res.status !== 200) throw new Error(`微博 HTTP ${res.status}：登录态可能已失效，请到后台「设置 → 采集凭据」更新 cookie`);
    const json = (await res.json()) as { data?: { list?: WeiboPost[]; since_id?: string } };
    if (!json.data?.list) throw new Error("微博返回里没有 data.list：登录态已失效，请到后台「设置 → 采集凭据」更新 cookie 和 XSRF token");
    sinceId = json.data.since_id;
    for (const post of json.data.list) {
      avatar ??= avatarOf(post);
      const item = await toItem(post, uid, headers);
      if (item) out.push(item);
    }
  }
  return { items: out, avatar };
}
