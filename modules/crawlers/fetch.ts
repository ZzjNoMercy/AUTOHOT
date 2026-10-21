// 采集器的执行：把到点的源交给对应采集器；落库走引擎的 upsertMaterial + queueProcessing，
// 抓取结果用引擎的 recordFetch 记账（健康、失败退避、下次抓取时间都跟引擎一致）。
import { sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { recordFetch } from "@aihot/backend/sources/collect";
import { collectCls } from "./cls.ts";
import { collectWeibo } from "./weibo.ts";
import { saveCollectedIcon, type Topic } from "./registry.ts";
import type { CrawledItem } from "./types.ts";

interface CrawlerRow {
  id: string;
  collector: string;
  account: string | null;
  cursor: Record<string, unknown> | null;
  topics: Topic[] | null;
}

export interface CrawlerResult {
  sourceId: string;
  status: "ok" | "failed" | "skipped";
  found: number;
  created: number;
  error?: string;
}

const ROW_COLUMNS = () => sql`cs.source_id AS id, cs.collector, cs.account, cs.topics, s.cursor`;

async function dueSources(force: boolean): Promise<CrawlerRow[]> {
  return sql<CrawlerRow[]>`
    SELECT ${ROW_COLUMNS()}
    FROM crawler_sources cs JOIN sources s ON s.id = cs.source_id
    WHERE s.enabled AND (${force} OR s.next_fetch_at IS NULL OR s.next_fetch_at <= now())
    ORDER BY cs.collector, cs.source_id`;
}

async function loadSource(sourceId: string): Promise<CrawlerRow | null> {
  const [row] = await sql<CrawlerRow[]>`
    SELECT ${ROW_COLUMNS()}
    FROM crawler_sources cs JOIN sources s ON s.id = cs.source_id WHERE cs.source_id = ${sourceId}`;
  return row ?? null;
}

/** 落库：正文由采集器提供（这些站点的原文页框架抓不到），判重/旧文规则/分析/精选/归组全走引擎。 */
async function store(sourceId: string, items: CrawledItem[], backfill: string | null): Promise<number> {
  let created = 0;
  for (const item of items) {
    const res = await upsertMaterial({
      sourceId,
      url: item.url,
      title: item.title,
      bodyText: item.bodyText,
      bodyStatus: "ok",
      publishedAt: item.publishedAt,
      author: item.author ?? null,
      via: "crawlers",
      backfill,
    });
    if (res.created || res.revised || res.processingNeeded) await queueProcessing(res.articleId);
    if (res.created) created += 1;
  }
  return created;
}

/** 抓一个采集器源。首次运行按历史导入处理（旧文按原文时间归档，不刷屏）。 */
export async function fetchCrawlerSource(sourceId: string): Promise<CrawlerResult> {
  const source = await loadSource(sourceId);
  if (!source) return { sourceId, status: "skipped", found: 0, created: 0, error: "不是采集器信源" };
  const [run] = await sql<{ id: number }[]>`INSERT INTO fetch_runs (source_id) VALUES (${sourceId}) RETURNING id`;
  const firstImport = !source.cursor?.initializedAt;
  try {
    const items = source.collector === "weibo" ? await collectWeibo(String(source.account ?? "")) : await collectCls(source.topics ?? undefined);
    const created = await store(sourceId, items.items, firstImport ? "first-import" : null);
    if (items.avatar) await saveCollectedIcon(sourceId, items.avatar);
    const cursor = {
      ...(source.cursor ?? {}),
      initializedAt: source.cursor?.initializedAt ?? new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
    };
    await recordFetch(sql, sourceId, run!.id, {
      found: items.items.length, created, detail: { collector: source.collector, account: source.account }, cursor,
    });
    return { sourceId, status: "ok", found: items.items.length, created };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
    await recordFetch(sql, sourceId, run!.id, { found: 0, created: 0, detail: null, error: message, budget: false });
    return { sourceId, status: "failed", found: 0, created: 0, error: message };
  }
}

/** 到点的采集器源，串行抓（避免同时打同一个站点）。force 时忽略下次抓取时间。 */
export async function dispatchCrawlers(force = false): Promise<{ sources: number; created: number; failed: number }> {
  const rows = await dueSources(force);
  let created = 0;
  let failed = 0;
  for (const row of rows) {
    const res = await fetchCrawlerSource(row.id);
    created += res.created;
    if (res.status === "failed") failed += 1;
  }
  return { sources: rows.length, created, failed };
}
