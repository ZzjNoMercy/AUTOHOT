// Public read of specials. Every report is read through the publication scope, so withdrawals and
// unlisted material leave the page at once; a special is only visible once published.
import { sql } from "@aihot/backend/db";
import { listedCondition } from "@aihot/backend/publication/scope";
import { sourceGroupKey, sourceGroupName } from "@aihot/backend/publication/source-identity";
import type { SpecialDetail, SpecialListItem, SpecialReportItem, SpecialsResponse, SpecialTimelineItem } from "./types.ts";

const dateOnly = (value: Date | null): string | null => value ? value.toISOString().slice(0, 10) : null;

interface ReportRow {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  selected: boolean;
  timeline_at: Date;
  source_id: string;
  source_name: string;
  source_kind: string;
  source_group_id: string | null;
  story_public_id: string | null;
  story_title: string | null;
}

function reportItem(row: ReportRow): SpecialReportItem {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    sourceName: row.source_name,
    publishedAt: row.timeline_at.toISOString(),
    selected: row.selected,
    storyPublicId: row.story_public_id,
    storyTitle: row.story_title,
  };
}

export async function loadSpecials(now = new Date()): Promise<SpecialsResponse> {
  const rows = await sql<{
    slug: string; title: string; intro: string | null; digest: string | null; starts_at: Date | null; ends_at: Date | null;
    cover_url: string | null; updated_at: Date; reports: number; stories: number; sources: number;
  }[]>`
    SELECT s.slug, s.title, s.intro, s.digest, s.starts_at, s.ends_at, s.cover_url, s.updated_at,
           coalesce(c.reports, 0)::int AS reports, coalesce(c.stories, 0)::int AS stories, coalesce(c.sources, 0)::int AS sources
    FROM specials s
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS reports, count(DISTINCT coalesce(st.public_id::text, p.article_id))::int AS stories,
             count(DISTINCT coalesce(src.source_group_id, CASE WHEN src.kind = 'weibo' THEN 'weibo' ELSE src.id END))::int AS sources
      FROM special_reports sr
      JOIN publications p ON p.article_id = sr.article_id
      JOIN sources src ON src.id = p.source_id
      LEFT JOIN facts f ON f.id = p.fact_id
      LEFT JOIN stories st ON st.id = f.story_id
      WHERE sr.special_id = s.id AND ${listedCondition(now)}
    ) c ON true
    WHERE s.status = 'published'
    ORDER BY s.updated_at DESC, s.id DESC`;
  const specials: SpecialListItem[] = rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    intro: r.intro,
    digest: r.digest,
    startsAt: dateOnly(r.starts_at),
    endsAt: dateOnly(r.ends_at),
    coverUrl: r.cover_url,
    reportCount: Number(r.reports),
    storyCount: Number(r.stories),
    sourceCount: Number(r.sources),
    updatedAt: r.updated_at.toISOString(),
  }));
  return { specials };
}

export async function loadSpecialBySlug(slug: string, now = new Date()): Promise<SpecialDetail | null> {
  const [special] = await sql<{
    id: number; slug: string; title: string; intro: string | null; digest: string | null; starts_at: Date | null; ends_at: Date | null;
    cover_url: string | null; updated_at: Date;
  }[]>`SELECT id, slug, title, intro, digest, starts_at, ends_at, cover_url, updated_at
       FROM specials WHERE slug = ${slug} AND status = 'published'`;
  if (!special) return null;
  const rows = await sql<ReportRow[]>`
    SELECT p.article_id AS id, p.title, p.summary, p.url, p.selected, p.timeline_at,
           src.id AS source_id, src.name AS source_name, src.kind AS source_kind, src.source_group_id,
           st.public_id::text AS story_public_id, st.title AS story_title
    FROM special_reports sr
    JOIN publications p ON p.article_id = sr.article_id
    JOIN sources src ON src.id = p.source_id
    LEFT JOIN facts f ON f.id = p.fact_id
    LEFT JOIN stories st ON st.id = f.story_id
    WHERE sr.special_id = ${special.id} AND ${listedCondition(now)}
    ORDER BY p.timeline_at DESC, p.article_id DESC`;
  const reports = rows.map(reportItem);
  const groups = new Map<string, { title: string; latestAt: Date; reports: ReportRow[] }>();
  for (const row of rows) {
    const key = row.story_public_id ?? `a:${row.id}`;
    const group = groups.get(key) ?? { title: row.story_title ?? row.title, latestAt: row.timeline_at, reports: [] };
    group.reports.push(row);
    if (row.timeline_at > group.latestAt) group.latestAt = row.timeline_at;
    groups.set(key, group);
  }
  const timeline: SpecialTimelineItem[] = [...groups.entries()].map(([key, group]) => {
    const sources = new Set(group.reports.map((r) => sourceGroupKey({
      id: r.source_id, name: r.source_name, kind: r.source_kind, source_group_id: r.source_group_id,
    })));
    const representative = group.reports[0] ?? null;
    return {
      storyPublicId: key.startsWith("a:") ? null : key,
      title: group.title,
      latestAt: group.latestAt.toISOString(),
      reportCount: group.reports.length,
      sourceCount: sources.size,
      report: representative ? reportItem(representative) : null,
    };
  }).sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  const byGroup = new Map<string, string>();
  for (const row of rows) {
    const source = { id: row.source_id, name: row.source_name, kind: row.source_kind, source_group_id: row.source_group_id };
    byGroup.set(sourceGroupKey(source), sourceGroupName(source));
  }
  return {
    slug: special.slug,
    title: special.title,
    intro: special.intro,
    digest: special.digest,
    startsAt: dateOnly(special.starts_at),
    endsAt: dateOnly(special.ends_at),
    coverUrl: special.cover_url,
    reportCount: reports.length,
    storyCount: timeline.length,
    sourceCount: byGroup.size,
    updatedAt: special.updated_at.toISOString(),
    participants: [...byGroup.values()],
    timeline,
    reports,
  };
}
