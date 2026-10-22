// Membership and automatic matching. A special collects reports that name it (title, summary or the
// first part of the body) inside its date window; editors can detach one and the exclusion keeps it out.
import { sql } from "@aihot/backend/db";
import { listedCondition } from "@aihot/backend/publication/scope";
import { createHash } from "node:crypto";

export interface SpecialRow {
  id: number;
  public_id: string;
  slug: string;
  title: string;
  intro: string | null;
  digest: string | null;
  digest_updated_at: Date | null;
  starts_at: Date | null;
  ends_at: Date | null;
  cover_url: string | null;
  status: "draft" | "published" | "archived";
  updated_at: Date;
  aliases: string[];
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export async function loadSpecial(id: number): Promise<SpecialRow | null> {
  const [special] = await sql<Omit<SpecialRow, "aliases">[]>`
    SELECT id, public_id::text, slug, title, intro, digest, digest_updated_at, starts_at, ends_at, cover_url, status, updated_at
    FROM specials WHERE id = ${id}`;
  if (!special) return null;
  const aliases = (await sql<{ alias: string }[]>`SELECT alias FROM special_aliases WHERE special_id = ${id} ORDER BY alias`).map((r) => r.alias);
  return { ...special, aliases };
}

export function aliasesOf(special: Pick<SpecialRow, "title" | "aliases">): string[] {
  return [...new Set([special.title, ...special.aliases].map((a) => a.trim()).filter((a) => a.length >= 2))];
}

function aliasMatch(aliases: string[]) {
  return aliases.map((alias) => {
    const like = `%${escapeLike(alias)}%`;
    return sql`(p.title ILIKE ${like} OR coalesce(p.summary, '') ILIKE ${like} OR left(coalesce(a.body_text, ''), 4000) ILIKE ${like})`;
  }).reduce((all, one) => sql`${all} OR ${one}`, sql`false`);
}

function windowMatch(special: Pick<SpecialRow, "starts_at" | "ends_at">) {
  return sql`${special.starts_at ? sql`p.timeline_at >= (${special.starts_at}::date::timestamp AT TIME ZONE 'Asia/Shanghai')` : sql`true`}
    AND ${special.ends_at ? sql`p.timeline_at < ((${special.ends_at}::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')` : sql`true`}`;
}

/** Current public reports whose text names this special, inside its window. */
async function matchingIds(special: SpecialRow, now: Date): Promise<string[]> {
  const aliases = aliasesOf(special);
  if (!aliases.length) return [];
  const rows = await sql<{ article_id: string }[]>`
    SELECT p.article_id
    FROM publications p JOIN articles a ON a.id = p.article_id
    WHERE ${listedCondition(now)}
      AND ${windowMatch(special)}
      AND (${aliasMatch(aliases)})
      AND NOT EXISTS (SELECT 1 FROM special_exclusions e WHERE e.special_id = ${special.id} AND e.article_id = p.article_id)`;
  return rows.map((r) => r.article_id);
}

/** Reconcile automatic members; manual members stay. Returns whether the member set changed. */
export async function syncMembership(special: SpecialRow, now = new Date()): Promise<{ changed: boolean; reports: number }> {
  const ids = await matchingIds(special, now);
  const before = (await sql<{ article_id: string }[]>`
    SELECT article_id FROM special_reports WHERE special_id = ${special.id} AND source = 'auto'`).map((r) => r.article_id);
  const beforeSet = new Set(before);
  const afterSet = new Set(ids);
  const changed = beforeSet.size !== afterSet.size || [...beforeSet].some((id) => !afterSet.has(id));
  if (beforeSet.size) {
    await sql`DELETE FROM special_reports WHERE special_id = ${special.id} AND source = 'auto'
      AND article_id NOT IN ${sql(ids.length ? ids : [""])}`;
  }
  if (ids.length) {
    await sql`INSERT INTO special_reports (special_id, article_id, source, confidence)
      SELECT ${special.id}, t.article_id, 'auto', 0.8 FROM unnest(${ids}::text[]) AS t(article_id)
      ON CONFLICT (special_id, article_id) DO NOTHING`;
  }
  const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM special_reports WHERE special_id = ${special.id}`;
  return { changed, reports: Number(count?.n ?? 0) };
}

export async function syncPublished(now = new Date()): Promise<{ specials: number; changed: number }> {
  const ids = await sql<{ id: number }[]>`SELECT id FROM specials WHERE status = 'published'`;
  let changed = 0;
  for (const { id } of ids) {
    const special = await loadSpecial(id);
    if (special && (await syncMembership(special, now)).changed) changed += 1;
  }
  return { specials: ids.length, changed };
}

export async function attachManual(specialId: number, articleId: string): Promise<boolean> {
  const [article] = await sql<{ id: string }[]>`SELECT id FROM articles WHERE id = ${articleId}`;
  if (!article) return false;
  await sql`DELETE FROM special_exclusions WHERE special_id = ${specialId} AND article_id = ${articleId}`;
  await sql`INSERT INTO special_reports (special_id, article_id, source, confidence) VALUES (${specialId}, ${articleId}, 'manual', 1)
    ON CONFLICT (special_id, article_id) DO UPDATE SET source = 'manual', confidence = 1`;
  return true;
}

export async function detach(specialId: number, articleId: string): Promise<boolean> {
  const result = await sql`DELETE FROM special_reports WHERE special_id = ${specialId} AND article_id = ${articleId}`;
  await sql`INSERT INTO special_exclusions (special_id, article_id) VALUES (${specialId}, ${articleId}) ON CONFLICT DO NOTHING`;
  return result.count > 0;
}

/** The stored overview matches the current member set. */
export async function digestIsCurrent(special: SpecialRow): Promise<boolean> {
  if (!special.digest) return false;
  const [last] = await sql<{ input_hash: string }[]>`
    SELECT input_hash FROM special_digests WHERE special_id = ${special.id} ORDER BY version DESC LIMIT 1`;
  if (!last) return false;
  return last.input_hash === (await memberHash(special.id));
}

export async function memberHash(specialId: number): Promise<string> {
  const rows = await sql<{ article_id: string }[]>`
    SELECT sr.article_id FROM special_reports sr JOIN publications p ON p.article_id = sr.article_id
    WHERE sr.special_id = ${specialId} AND ${listedCondition(new Date())} ORDER BY sr.article_id`;
  const ids = rows.map((r) => r.article_id);
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}
