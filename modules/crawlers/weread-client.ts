import { credential } from "@aihot/backend/config";
import { guardedFetch, type GuardedResponse } from "@aihot/backend/lib/http-fetch";

const DEFAULT_BASE = "https://weread.qq.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

export type WereadCookieJar = Record<string, string>;
export type WereadErrorCode = "auth_suspected" | "rate_limited" | "invalid_response" | "transient" | "provider_error" | "invalid_content";

export class WereadError extends Error {
  readonly code: WereadErrorCode;
  readonly providerCode: string | number | null;
  readonly httpStatus: number | null;

  constructor(code: WereadErrorCode, message: string, providerCode: string | number | null = null, httpStatus: number | null = null) {
    super(message);
    this.name = "WereadError";
    this.code = code;
    this.providerCode = providerCode;
    this.httpStatus = httpStatus;
  }
}

export interface WereadCover {
  name: string | null;
  title: string;
  reviewId: string;
  pic: string | null;
  avatar: string | null;
  digest: string | null;
  publishedAt: Date | null;
  raw: Record<string, unknown>;
}

function baseUrl(): string {
  return (credential("collectors", "WEREAD_BASE_URL") ?? DEFAULT_BASE).replace(/\/$/, "");
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function businessCode(payload: Record<string, unknown>): string | number | null {
  const data = object(payload.data);
  for (const container of [payload, data]) {
    if (!container) continue;
    for (const key of ["errcode", "errCode", "statusCode"]) {
      const value = container[key];
      if ((typeof value === "number" && value !== 0 && value !== 200) || (typeof value === "string" && value && value !== "0" && value !== "200")) return value;
    }
    if (typeof container.errcode === "number" && container.errcode !== 0) return container.errcode;
  }
  return null;
}

function classifyBusiness(code: string | number): WereadError {
  const numeric = typeof code === "number" ? code : Number(code);
  const message = `微信读书业务错误 ${String(code)}`.slice(0, 160);
  if (numeric === -2010 || numeric === -2012) return new WereadError("auth_suspected", message, code);
  if (numeric === -2014 || numeric === -2041) return new WereadError("rate_limited", message, code);
  return new WereadError("provider_error", message, code);
}

function httpError(status: number, label: string): WereadError {
  if (status === 401 || status === 403) return new WereadError("auth_suspected", `${label}返回 HTTP ${status}`, null, status);
  if (status === 429 || status === 499) return new WereadError("rate_limited", `${label}返回 HTTP ${status}`, null, status);
  return new WereadError("transient", `${label}返回 HTTP ${status}`, null, status);
}

function parseJson(res: GuardedResponse, label: string, checkBusiness = true): Record<string, unknown> {
  if (res.status < 200 || res.status >= 300) throw httpError(res.status, label);
  let payload: unknown;
  try {
    payload = JSON.parse(res.text());
  } catch {
    throw new WereadError("invalid_response", `${label}返回了非 JSON 响应`, null, res.status);
  }
  const json = object(payload);
  if (!json) throw new WereadError("invalid_response", `${label}响应不是对象`, null, res.status);
  if (checkBusiness) {
    const code = businessCode(json);
    if (code !== null) throw classifyBusiness(code);
  }
  return json;
}

export function absorbSetCookie(jar: WereadCookieJar, values: readonly string[], now = Date.now()): void {
  for (const raw of values) {
    const [pair, ...attributes] = raw.split(";");
    const cut = pair?.indexOf("=") ?? -1;
    if (!pair || cut <= 0) continue;
    const name = pair.slice(0, cut).trim();
    const value = pair.slice(cut + 1).trim();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) continue;
    let remove = value === "";
    for (const attribute of attributes) {
      const [key, rawValue] = attribute.split("=", 2);
      if (key?.trim().toLowerCase() === "max-age" && Number(rawValue) <= 0) remove = true;
      if (key?.trim().toLowerCase() === "expires" && rawValue && Date.parse(rawValue) <= now) remove = true;
    }
    if (remove) delete jar[name];
    else jar[name] = value;
  }
}

function cookieHeader(jar: WereadCookieJar): string {
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join("; ");
}

function transportDetail(error: unknown): string {
  const value = error as { name?: unknown; code?: unknown; cause?: { code?: unknown; errors?: Array<{ code?: unknown }> } | undefined };
  const code = value.code ?? value.cause?.code ?? value.cause?.errors?.[0]?.code;
  if (typeof code === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(code)) return code;
  return typeof value.name === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(value.name) ? value.name : "network_error";
}

async function request(pathname: string, jar: WereadCookieJar, init: { method?: string; body?: string; timeoutMs?: number; maxBytes?: number } = {}): Promise<GuardedResponse> {
  try {
    const res = await guardedFetch(`${baseUrl()}${pathname}`, {
      method: init.method ?? "GET",
      body: init.body,
      timeoutMs: init.timeoutMs ?? 25_000,
      maxBytes: init.maxBytes ?? 12 * 1024 * 1024,
      maxRedirects: 0,
      route: "direct",
      headers: {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        origin: DEFAULT_BASE,
        referer: `${DEFAULT_BASE}/`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookieHeader(jar) ? { cookie: cookieHeader(jar) } : {}),
      },
    });
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    absorbSetCookie(jar, headers.getSetCookie?.() ?? []);
    return res;
  } catch (error) {
    if (error instanceof WereadError) throw error;
    throw new WereadError("transient", `微信读书请求暂时失败（${transportDetail(error)}）`);
  }
}

export async function loginUid(jar: WereadCookieJar): Promise<string> {
  const json = parseJson(await request("/api/auth/getLoginUid", jar), "获取扫码标识");
  const uid = json.uid ?? object(json.data)?.uid;
  if (typeof uid !== "string" || !uid.trim()) throw new WereadError("invalid_response", "扫码响应缺少 uid");
  return uid.trim();
}

export function loginConfirmUrl(uid: string): string {
  return `${DEFAULT_BASE}/web/confirm?uid=${encodeURIComponent(uid)}`;
}

export async function pollLogin(jar: WereadCookieJar, uid: string): Promise<Record<string, unknown>> {
  return parseJson(await request(`/api/auth/getLoginInfo?uid=${encodeURIComponent(uid)}&otp=`, jar, { timeoutMs: 75_000 }), "查询扫码状态", false);
}

export function loginSucceeded(payload: Record<string, unknown>): boolean {
  const data = object(payload.data);
  return payload.succeed === true || payload.succeed === 1 || data?.succeed === true || data?.succeed === 1;
}

export function loginCode(payload: Record<string, unknown>): string | null {
  const data = object(payload.data);
  const code = payload.errcode ?? payload.errCode ?? payload.statusCode ?? data?.errcode ?? data?.errCode ?? data?.statusCode;
  return code === undefined || code === null || code === "" ? null : String(code);
}

export async function validateWereadSession(jar: WereadCookieJar): Promise<void> {
  const json = parseJson(await request("/web/shelf/sync?userVid=&synckey=0&lectureSynckey=0", jar), "验证书架会话");
  const data = object(json.data) ?? json;
  if (!Array.isArray(data.books) && typeof data.synckey !== "number") {
    throw new WereadError("invalid_response", "书架验证响应缺少预期字段");
  }
}

export async function renewWereadSession(jar: WereadCookieJar): Promise<void> {
  const res = await request("/web/login/renewal", jar, {
    method: "POST",
    body: JSON.stringify({ rq: "%2Fweb%2Fbook%2Fread", ql: true }),
  });
  const json = parseJson(res, "续期微信读书会话", false);
  const code = businessCode(json);
  if (code !== null) throw classifyBusiness(code);
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function wereadCover(jar: WereadCookieJar, bookId: string): Promise<WereadCover> {
  const json = parseJson(await request(`/api/mp/cover?bookId=${encodeURIComponent(bookId)}`, jar), "读取公众号最新文章");
  const cover = object(json.data) && json.reviewId === undefined ? object(json.data)! : json;
  const reviewId = typeof cover.reviewId === "string" ? cover.reviewId.trim() : "";
  const title = typeof cover.title === "string" ? cover.title.trim() : "";
  if (!reviewId || !title) throw new WereadError("invalid_response", "最新文章响应缺少 reviewId 或标题");
  return {
    name: typeof cover.name === "string" && cover.name.trim() ? cover.name.trim() : null,
    title,
    reviewId,
    pic: typeof cover.pic === "string" && cover.pic.trim() ? cover.pic.trim() : null,
    avatar: typeof cover.avatar === "string" && cover.avatar.trim() ? cover.avatar.trim() : null,
    digest: typeof cover.digest === "string" && cover.digest.trim() ? cover.digest.trim() : null,
    publishedAt: timestamp(cover.time ?? cover.createTime ?? cover.publishTime),
    raw: cover,
  };
}

export async function wereadContent(jar: WereadCookieJar, reviewId: string): Promise<string> {
  const res = await request(`/web/mp/content?reviewId=${encodeURIComponent(reviewId)}`, jar, { maxBytes: 16 * 1024 * 1024 });
  if (res.status < 200 || res.status >= 300) throw httpError(res.status, "读取文章正文");
  const html = res.text();
  if (/^\s*\{/.test(html)) {
    try {
      const json = JSON.parse(html) as unknown;
      const payload = object(json);
      if (payload) {
        const code = businessCode(payload);
        if (code !== null) throw classifyBusiness(code);
      }
    } catch (error) {
      if (error instanceof WereadError) throw error;
    }
  }
  if (!html.trim()) throw new WereadError("invalid_content", "正文响应为空");
  return html;
}
