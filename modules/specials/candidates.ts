// Conference candidates from recent public titles: a cheap, readable scan for the editor, never a
// publication decision. A report joins a candidate only through a conference name in its title; the
// editor confirms the identity before anything public exists.
import { sql } from "@aihot/backend/db";
import { listedCondition } from "@aihot/backend/publication/scope";
import type { SpecialCandidate } from "./types.ts";

const CONFERENCE = /([\p{Script=Han}A-Za-z0-9·\-]{2,32}(?:创新大会|大会|峰会|论坛|发布会|车展|科技日|AI\s*Day|AI日))/gu;
const LEADING = /^(?:速览|直击|聚焦|关注|现场直击|现场|图集|视频|直播|开幕|闭幕|前瞻|盘点|回顾|一文看懂|重磅)/;
const TRAILING = /[：:，,。！!？?、\s]+$/;

/** Possible conference names in a title, with dates and leading verbs removed. */
export function conferenceNames(title: string): string[] {
  const out = new Set<string>();
  // Match on a compact title: a space before a date would otherwise start the match at "日举办…".
  for (const match of title.replace(/\s+/g, "").matchAll(CONFERENCE)) {
    let name = match[1]!.trim();
    name = name
      .replace(LEADING, "")
      .replace(/\d{4}\s*年?/g, "")
      .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, "")
      .replace(/(?:将|于|在|由|举办|举行|召开|开幕|闭幕|亮相|发布|预告|直击|速览|聚焦|盘点|回顾|现场|下周|本周|今天|明日|昨日)/g, "")
      .replace(/^日/, "")
      .replace(TRAILING, "")
      .trim();
    if (name.length >= 4) out.add(name);
  }
  return [...out];
}

/** Identity of a name across "2026 奇瑞创新大会" and "奇瑞创新大会". */
export function candidateKey(name: string): string {
  return name.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function sourceKey(row: { source_id: string; owner_entity_id: string | null; signal_group_id: string | null }): string {
  if (row.signal_group_id) return `group:${row.signal_group_id}`;
  if (row.owner_entity_id) return `owner:${row.owner_entity_id}`;
  return `source:${row.source_id}`;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** A title seeds the name; reports that mention it only in the body still belong to the same conference. */
async function expandByBody(group: { name: string; reports: Set<string>; sources: Set<string>; samples: string[]; first: Date; last: Date }, now: Date, days: number) {
  const like = `%${escapeLike(group.name)}%`;
  const rows = await sql<{ article_id: string; title: string; source_id: string; owner_entity_id: string | null; signal_group_id: string | null; timeline_at: Date }[]>`
    SELECT p.article_id, p.title, p.source_id, s.owner_entity_id, s.signal_group_id, p.timeline_at
    FROM publications p JOIN articles a ON a.id = p.article_id JOIN sources s ON s.id = p.source_id
    WHERE ${listedCondition(now)}
      AND p.timeline_at > ${now}::timestamptz - make_interval(days => ${days})
      AND (p.title ILIKE ${like} OR coalesce(p.summary, '') ILIKE ${like} OR left(coalesce(a.body_text, ''), 4000) ILIKE ${like})`;
  for (const row of rows) {
    group.reports.add(row.article_id);
    group.sources.add(sourceKey(row));
    if (group.samples.length < 5 && !group.samples.includes(row.title)) group.samples.push(row.title);
    if (row.timeline_at < group.first) group.first = row.timeline_at;
    if (row.timeline_at > group.last) group.last = row.timeline_at;
  }
}

/** Recent conference-like titles grouped by name; only names several independent sources mention. */
export async function scanCandidates(days = 14): Promise<SpecialCandidate[]> {
  const now = new Date();
  const rows = await sql<{
    article_id: string; title: string; source_id: string; owner_entity_id: string | null; signal_group_id: string | null; timeline_at: Date;
  }[]>`
    SELECT p.article_id, p.title, p.source_id, s.owner_entity_id, s.signal_group_id, p.timeline_at
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE ${listedCondition(now)}
      AND p.timeline_at > ${now}::timestamptz - make_interval(days => ${days})
      AND p.title ~ '(大会|峰会|论坛|发布会|车展|科技日|AI ?Day)'`;
  const groups = new Map<string, { name: string; reports: Set<string>; sources: Set<string>; samples: string[]; first: Date; last: Date }>();
  for (const row of rows) {
    for (const name of conferenceNames(row.title)) {
      const key = candidateKey(name);
      if (!key) continue;
      const group = groups.get(key) ?? { name, reports: new Set<string>(), sources: new Set<string>(), samples: [], first: row.timeline_at, last: row.timeline_at };
      group.reports.add(row.article_id);
      group.sources.add(sourceKey(row));
      if (group.samples.length < 5 && !group.samples.includes(row.title)) group.samples.push(row.title);
      if (row.timeline_at < group.first) group.first = row.timeline_at;
      if (row.timeline_at > group.last) group.last = row.timeline_at;
      groups.set(key, group);
    }
  }

  // Titles only produce the names; the body decides whether more independent sources mentioned it.
  for (const group of groups.values()) await expandByBody(group, now, days);

  const existing = await sql<{ title: string; alias: string | null }[]>`
    SELECT s.title, a.alias FROM specials s LEFT JOIN special_aliases a ON a.special_id = s.id`;
  const known = existing.flatMap((r) => [r.title, r.alias].filter((x): x is string => !!x).map(candidateKey));
  const ignored = new Set((await sql<{ candidate_key: string }[]>`SELECT candidate_key FROM special_ignored_candidates
    WHERE ignored_at > now() - interval '90 days'`).map((r) => r.candidate_key));

  return [...groups.entries()]
    .filter(([key, group]) => group.reports.size >= 3 && group.sources.size >= 3
      && !ignored.has(key)
      && !known.some((k) => k === key || (k.length >= 4 && (key.includes(k) || k.includes(key)))))
    .map(([key, group]) => ({
      key,
      name: group.name,
      reportCount: group.reports.size,
      sourceCount: group.sources.size,
      firstAt: group.first.toISOString(),
      lastAt: group.last.toISOString(),
      samples: group.samples,
    }))
    .sort((a, b) => b.sourceCount - a.sourceCount || b.reportCount - a.reportCount || b.lastAt!.localeCompare(a.lastAt!))
    .slice(0, 40);
}

export async function ignoreCandidate(key: string): Promise<void> {
  await sql`INSERT INTO special_ignored_candidates (candidate_key) VALUES (${key}) ON CONFLICT DO NOTHING`;
}
