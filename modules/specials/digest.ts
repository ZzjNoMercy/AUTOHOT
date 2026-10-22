// A special's overview, written from its current public member events. Like the story digest it is
// rebuilt only when the member evidence changes, and the paid response is stored before it is shown.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { SITE } from "@aihot/site";
import { sql } from "@aihot/backend/db";
import { sha256, stableJson } from "@aihot/backend/lib/ids";
import { modelFor } from "@aihot/backend/editorial/models";
import { chatJson } from "@aihot/backend/providers/llm";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { listedCondition } from "@aihot/backend/publication/scope";
import { loadSpecial } from "./membership.ts";

const PROMPT = readFileSync(new URL("./prompt.md", import.meta.url), "utf8").replaceAll("{{siteName}}", SITE.name);
export const SPECIAL_DIGEST_PROMPT_VERSION = `special-digest@${sha256(PROMPT).slice(0, 10)}`;

const DigestSchema = z.object({ digest: z.string().min(20).max(1500) });

interface MemberReport {
  article_id: string;
  title: string;
  summary: string | null;
  story_title: string | null;
  story_digest: string | null;
  timeline_at: Date;
}

async function members(specialId: number, now = new Date()): Promise<MemberReport[]> {
  return sql<MemberReport[]>`
    SELECT sr.article_id, p.title, p.summary, st.title AS story_title, st.digest AS story_digest, p.timeline_at
    FROM special_reports sr
    JOIN publications p ON p.article_id = sr.article_id
    LEFT JOIN facts f ON f.id = p.fact_id
    LEFT JOIN stories st ON st.id = f.story_id
    WHERE sr.special_id = ${specialId} AND ${listedCondition(now)}
    ORDER BY p.timeline_at ASC, sr.article_id`;
}

function inputOf(special: { title: string; intro: string | null; startsAt?: string | null; endsAt?: string | null }, reports: MemberReport[]): string {
  const lines = reports.slice(-60).map((r) => {
    const heading = r.story_title ?? r.title;
    const detail = r.story_digest ?? r.summary ?? "";
    return `- ${heading}${detail ? `：${detail.slice(0, 300)}` : ""}`;
  });
  return [
    `专题：${special.title}`,
    special.intro ? `已有导语：${special.intro}` : "",
    `成员事件（按时间）：`,
    ...lines,
  ].filter(Boolean).join("\n");
}

/** Write the overview when the current member evidence differs from the last saved version. */
export async function composeSpecialDigest(specialId: number, opts: { rewrite?: boolean } = {}): Promise<{ updated: boolean; version?: number }> {
  const special = await loadSpecial(specialId);
  if (!special || special.status !== "published") return { updated: false };
  const reports = await members(specialId);
  if (!reports.length) {
    await sql`UPDATE specials SET digest = NULL, digest_updated_at = NULL, updated_at = now() WHERE id = ${specialId}`;
    return { updated: false };
  }
  const ids = reports.map((r) => r.article_id).sort();
  const input = inputOf({ ...special, startsAt: null, endsAt: null }, reports);
  const hash = sha256(stableJson({ ids, input }));
  const [last] = await sql<{ version: number; input_hash: string; digest: string; receipt_id: number | null }[]>`
    SELECT version, input_hash, digest, receipt_id FROM special_digests WHERE special_id = ${specialId} ORDER BY version DESC LIMIT 1`;
  if (!opts.rewrite && last?.input_hash === hash) return { updated: false };
  const res = await chatJson({
    model: await modelFor("digest"),
    purpose: "special_digest",
    subject: `special:${specialId}`,
    promptVersion: SPECIAL_DIGEST_PROMPT_VERSION,
    system: PROMPT,
    user: input,
    schema: DigestSchema,
    temperature: 0.3,
    maxTokens: 1200,
  });
  const version = (last?.version ?? 0) + 1;
  const saved = await sql.begin(async (tx) => {
    await tx`INSERT INTO special_digests (special_id, version, digest, input_hash, article_ids, receipt_id)
      VALUES (${specialId}, ${version}, ${res.data.digest}, ${hash}, ${ids}, ${res.receiptId})`;
    await tx`UPDATE specials SET digest = ${res.data.digest}, digest_updated_at = now(), updated_at = now() WHERE id = ${specialId}`;
    if (res.receiptId !== null) await completeReceipt(tx, res.receiptId);
    return true;
  });
  return saved ? { updated: true, version } : { updated: false };
}

/** Every published special whose overview is stale (the scheduled pass; failures stay for the next run). */
export async function refreshSpecialDigests(limit = 10): Promise<number> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM specials WHERE status = 'published' ORDER BY digest_updated_at ASC NULLS FIRST, id LIMIT ${limit}`;
  let updated = 0;
  for (const { id } of rows) {
    try { if ((await composeSpecialDigest(id)).updated) updated += 1; } catch { /* next run retries; the last digest stays */ }
  }
  return updated;
}
