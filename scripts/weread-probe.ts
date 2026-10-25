// 微信读书探针：扫一次码，保存会话，然后验证 cover / content / articles。
// 只把会话写到 .data/（gitignore）；不打印 Cookie，也不把书架内容发到终端。
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderSVG } from "uqr";
import sharp from "sharp";

const BASE = "https://weread.qq.com";
const DATA = path.resolve(".data");
const SESSION = path.join(DATA, "weread-session.json");
const QR = path.join(DATA, "weread-login-qr.png");
const SAMPLE = path.join(DATA, "weread-sample.html");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

type Jar = Record<string, string>;
const jar: Jar = {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cookieHeader = () => Object.entries(jar).map(([name, value]) => `${name}=${value}`).join("; ");

function absorb(res: Response): void {
  const list = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const raw of list) {
    const pair = raw.split(";", 1)[0]!;
    const cut = pair.indexOf("=");
    if (cut > 0) jar[pair.slice(0, cut).trim()] = pair.slice(cut + 1).trim();
  }
}

async function request(pathname: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: {
      "user-agent": UA,
      accept: "application/json, text/plain, */*",
      origin: BASE,
      referer: `${BASE}/`,
      ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
    redirect: "manual",
  });
  absorb(res);
  return res;
}

function jsonOf(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
}

async function login(): Promise<void> {
  await mkdir(DATA, { recursive: true });
  const res = await request("/api/auth/getLoginUid");
  const body = jsonOf(await res.text());
  const uid = (body?.uid ?? (body?.data as Record<string, unknown> | undefined)?.uid) as string | undefined;
  if (!uid) throw new Error(`getLoginUid: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);

  const confirm = `${BASE}/web/confirm?uid=${encodeURIComponent(uid)}`;
  const svg = renderSVG(confirm, { border: 2, pixelSize: 8 });
  await sharp(Buffer.from(svg)).png().toFile(QR);
  console.log(`QR_READY ${QR}`);
  console.log(`CONFIRM ${confirm}`);

  const deadline = Date.now() + 480_000;
  while (Date.now() < deadline) {
    let poll: Response;
    try {
      poll = await request(`/api/auth/getLoginInfo?uid=${encodeURIComponent(uid)}&otp=`, { signal: AbortSignal.timeout(75_000) });
    } catch (error) {
      console.log(`POLL ${String((error as Error).message).slice(0, 120)}`);
      await sleep(1500);
      continue;
    }
    const text = await poll.text();
    const info = jsonOf(text);
    const data = info?.data as Record<string, unknown> | undefined;
    if (info?.succeed === true || info?.succeed === 1 || data?.succeed === true || data?.succeed === 1) {
      await writeFile(SESSION, JSON.stringify({ cookies: jar, at: new Date().toISOString() }, null, 2), { mode: 0o600 });
      await chmod(SESSION, 0o600);
      console.log("LOGIN_OK");
      return;
    }
    const code = info?.errcode ?? data?.errcode ?? info?.statusCode;
    if (code) console.log(`WAITING ${String(code)} ${String(info?.errmsg ?? data?.errmsg ?? info?.statusMessage ?? "")}`.slice(0, 200));
    await sleep(1500);
  }
  throw new Error("login timed out");
}

async function loadSession(): Promise<boolean> {
  try {
    const saved = JSON.parse(await readFile(SESSION, "utf8")) as { cookies?: Jar };
    for (const [name, value] of Object.entries(saved.cookies ?? {})) jar[name] = value;
    return Object.keys(jar).length > 0;
  } catch {
    return false;
  }
}

async function probe(bookId: string): Promise<void> {
  const shelf = await request("/web/shelf/bookIds");
  const shelfText = await shelf.text();
  const shelfJson = jsonOf(shelfText);
  console.log(`SHELF HTTP ${shelf.status} keys=${shelfJson ? Object.keys(shelfJson).join(",") : "non-json"}`);

  const cover = await request(`/api/mp/cover?bookId=${encodeURIComponent(bookId)}`);
  const coverText = await cover.text();
  const coverJson = jsonOf(coverText);
  console.log(`COVER HTTP ${cover.status} ${coverText.slice(0, 1200)}`);

  const reviewId = (coverJson?.reviewId ?? (coverJson?.data as Record<string, unknown> | undefined)?.reviewId) as string | undefined;
  if (reviewId) {
    const content = await request(`/web/mp/content?reviewId=${encodeURIComponent(reviewId)}`);
    const html = await content.text();
    await writeFile(SAMPLE, html);
    const canonical = /<meta[^>]+(?:property|name)=["']og:url["'][^>]+content=["']([^"']+)/i.exec(html)?.[1]
      ?? /var\s+msg_link\s*=\s*["']([^"']+)/.exec(html)?.[1]
      ?? null;
    console.log(`CONTENT HTTP ${content.status} type=${content.headers.get("content-type")} bytes=${html.length} js_content=${html.includes("js_content")}`);
    console.log(`CONTENT_CANONICAL ${canonical ?? "not found"}`);
    console.log(`CONTENT_SAMPLE ${SAMPLE}`);
  } else {
    console.log("CONTENT skipped: cover has no reviewId");
  }

  const list = await request(`/web/mp/articles?bookId=${encodeURIComponent(bookId)}&offset=0`);
  console.log(`ARTICLES HTTP ${list.status} ${(await list.text()).slice(0, 400)}`);
}

const args = process.argv.slice(2);
const mode = args[0] === "login" || args[0] === "test" ? args[0] : null;
const bookId = args.find((arg) => arg.startsWith("MP_WXS_")) ?? "MP_WXS_3221033578";

try {
  if (mode !== "test") await login();
  else if (!(await loadSession())) throw new Error(`没有会话 ${SESSION}；先跑 login`);
  await probe(bookId);
} catch (error) {
  console.error(`FAIL ${String((error as Error).message).slice(0, 500)}`);
  process.exitCode = 1;
}
