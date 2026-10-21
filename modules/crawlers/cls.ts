// 财联社：签名在 signing/cls_index.js 里（原脚本的文件，第一行就是 window = global，本来就是给 Node 用的），
// 用 node:vm 加载一次，逐话题取最新快讯。签名每次请求现算，不需要任何凭据。
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { CLS_TOPICS, type Topic } from "./registry.ts";
import type { CollectResult, CrawledItem } from "./types.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

interface ClsArticle {
  article_id?: number | string;
  article_title?: string;
  article_brief?: string;
  article_time?: number;
}

/** 签名函数：加载一次，之后复用。bundle 自带的 console.log 用安静的 console 吃掉。 */
let signer: ((time: number, subjectId: number) => string) | null = null;

function loadSigner(): (time: number, subjectId: number) => string {
  if (signer) return signer;
  const file = new URL("./signing/cls_index.js", import.meta.url);
  // 末尾那行 console.log(get_sign()) 是原文件的自测调用，去掉再跑。
  const code = readFileSync(file, "utf8").replace(/console\.log\(get_sign\(\)\);?\s*$/, "");
  const quiet = { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const ctx = createContext({ console: quiet }) as { global?: unknown; get_sign?: (t: number, id: number) => unknown };
  ctx.global = ctx; // 文件第一行：window = global
  runInContext(code, ctx);
  if (typeof ctx.get_sign !== "function") throw new Error("财联社签名文件没有导出 get_sign");
  signer = (time, subjectId) => String(ctx.get_sign!(time, subjectId));
  return signer;
}

/** 原脚本的字段口径：有 brief 就用 brief 当正文；没有就把标题里 】 之后的部分当正文。 */
function toItem(a: ClsArticle): CrawledItem | null {
  const id = a.article_id;
  const raw = String(a.article_title ?? "").trim();
  if (!id || !raw) return null;
  const brief = String(a.article_brief ?? "").replace(/\s+/g, " ").trim();
  let title = raw;
  let body = brief;
  if (!brief) {
    const cut = raw.indexOf("】");
    if (cut >= 0) {
      title = raw.slice(0, cut).replace(/^【/, "").trim();
      body = raw.slice(cut + 1).replace(/\s+/g, " ").trim();
    }
  }
  if (!title) return null;
  return {
    url: `https://www.cls.cn/detail/${id}`,
    title,
    bodyText: body || title,
    publishedAt: typeof a.article_time === "number" ? new Date(a.article_time * 1000) : null,
  };
}

async function fetchTopic(topicId: string, at: number): Promise<CrawledItem[]> {
  const sign = loadSigner()(at, Number(topicId));
  const url = `https://www.cls.cn/api/subject/${topicId}/article?app=CailianpressWeb&last_article_time=${at}&os=web&Subject_Id=${topicId}&sv=7.7.5&sign=${sign}`;
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json", referer: `https://www.cls.cn/subject/${topicId}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`财联社 HTTP ${res.status}`);
  const json = (await res.json()) as { errno?: number; data?: ClsArticle[] };
  if (json.errno !== undefined && json.errno !== 0) throw new Error(`财联社 errno=${json.errno}（签名可能已失效）`);
  return (Array.isArray(json.data) ? json.data : []).map(toItem).filter((x): x is CrawledItem => x !== null);
}

/** 选中话题的最新快讯，按地址去重（同一篇可能同时挂在多个话题下）；没选过就抓默认的五个。 */
export async function collectCls(topics: readonly Topic[] = CLS_TOPICS): Promise<CollectResult> {
  const at = Math.floor(Date.now() / 1000);
  const seen = new Set<string>();
  const out: CrawledItem[] = [];
  for (const topic of topics) {
    for (const item of await fetchTopic(topic.id, at)) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      out.push(item);
    }
  }
  return { items: out };
}
