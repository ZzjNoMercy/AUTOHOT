// Back-office reads and writes for specials. The API guards authentication and CSRF; these functions
// only keep the special, its aliases and its members consistent.
import { sql } from "@aihot/backend/db";
import { newShortId, newUuid } from "@aihot/backend/lib/ids";
import { loadSpecial, syncMembership, attachManual, detach, type SpecialRow } from "./membership.ts";
import { scanCandidates } from "./candidates.ts";
import type { AdminSpecialDetail, AdminSpecialListItem, AdminSpecialReport, AdminSpecialsResponse } from "./types.ts";

const dateOnly = (value: Date | null): string | null => value ? value.toISOString().slice(0, 10) : null;

function status(value: string): AdminSpecialListItem["status"] {
  return value === "published" || value === "archived" ? value : "draft";
}

async function counts(id: number) {
  const [row] = await sql<{ reports: number; stories: number; sources: number }[]>`
    SELECT count(*)::int AS reports,
           count(DISTINCT st.id)::int AS stories,
           count(DISTINCT coalesce(src.source_group_id, CASE WHEN src.kind = 'weibo' THEN 'weibo' ELSE src.id END))::int AS sources
    FROM special_reports sr
    JOIN publications p ON p.article_id = sr.article_id
    JOIN sources src ON src.id = p.source_id
    LEFT JOIN facts f ON f.id = p.fact_id
    LEFT JOIN stories st ON st.id = f.story_id
    WHERE sr.special_id = ${id} AND p.visibility = 'public' AND p.eligible`;
  return { reports: Number(row?.reports ?? 0), stories: Number(row?.stories ?? 0), sources: Number(row?.sources ?? 0) };
}

export async function listAdminSpecials(): Promise<AdminSpecialsResponse> {
  const rows = await sql<{
    id: number; slug: string; title: string; intro: string | null; digest: string | null; starts_at: Date | null; ends_at: Date | null;
    cover_url: string | null; status: string; updated_at: Date; aliases: string[];
  }[]>`
    SELECT s.id, s.slug, s.title, s.intro, s.digest, s.starts_at, s.ends_at, s.cover_url, s.status, s.updated_at,
           coalesce(array_agg(a.alias ORDER BY a.alias) FILTER (WHERE a.alias IS NOT NULL), '{}') AS aliases
    FROM specials s LEFT JOIN special_aliases a ON a.special_id = s.id
    GROUP BY s.id ORDER BY s.updated_at DESC, s.id DESC`;
  const specials: AdminSpecialListItem[] = [];
  for (const row of rows) {
    const c = await counts(row.id);
    specials.push({
      id: row.id, slug: row.slug, title: row.title, intro: row.intro, digest: row.digest,
      startsAt: dateOnly(row.starts_at), endsAt: dateOnly(row.ends_at), coverUrl: row.cover_url,
      status: status(row.status), aliases: row.aliases,
      reportCount: c.reports, storyCount: c.stories, sourceCount: c.sources,
      updatedAt: row.updated_at.toISOString(),
    });
  }
  return { specials, candidates: await scanCandidates() };
}

export async function getAdminSpecial(id: number): Promise<AdminSpecialDetail | null> {
  const special = await loadSpecial(id);
  if (!special) return null;
  const rows = await sql<{
    article_id: string; source: "auto" | "manual"; title: string; source_name: string; timeline_at: Date | null;
    selected: boolean | null; story_public_id: string | null;
  }[]>`
    SELECT sr.article_id, sr.source, a.title, s.name AS source_name, p.timeline_at, p.selected, st.public_id::text AS story_public_id
    FROM special_reports sr
    JOIN articles a ON a.id = sr.article_id
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN publications p ON p.article_id = sr.article_id
    LEFT JOIN facts f ON f.id = p.fact_id
    LEFT JOIN stories st ON st.id = f.story_id
    WHERE sr.special_id = ${id}
    ORDER BY p.timeline_at DESC NULLS LAST, sr.created_at DESC`;
  const reports: AdminSpecialReport[] = rows.map((r) => ({
    articleId: r.article_id,
    title: r.title,
    sourceName: r.source_name,
    publishedAt: (r.timeline_at ?? new Date(0)).toISOString(),
    selected: r.selected === true,
    source: r.source,
    storyPublicId: r.story_public_id,
  }));
  const c = await counts(id);
  return {
    id: special.id, slug: special.slug, title: special.title, intro: special.intro, digest: special.digest,
    startsAt: dateOnly(special.starts_at), endsAt: dateOnly(special.ends_at), coverUrl: special.cover_url,
    status: special.status, aliases: special.aliases,
    reportCount: c.reports, storyCount: c.stories, sourceCount: c.sources,
    updatedAt: special.updated_at.toISOString(),
    reports,
  };
}

export interface CreateSpecialInput {
  title: string;
  slug?: string;
  aliases?: string[];
  startsAt?: string | null;
  endsAt?: string | null;
  intro?: string | null;
  coverUrl?: string | null;
}

const SLUG = /^[a-z0-9][a-z0-9-]{2,80}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function slugOf(input: { title: string; slug?: string }): string {
  const requested = input.slug?.trim().toLowerCase();
  if (requested) {
    if (!SLUG.test(requested)) throw Object.assign(new Error("slug 只能用小写字母、数字和连字符，3–80 位"), { statusCode: 400 });
    return requested;
  }
  return `special-${newShortId(6).toLowerCase()}`;
}

export async function createSpecial(input: CreateSpecialInput): Promise<number> {
  const title = input.title.trim();
  if (title.length < 2) throw Object.assign(new Error("专题标题太短"), { statusCode: 400 });
  if (input.startsAt && !DATE.test(input.startsAt)) throw Object.assign(new Error("开始日期格式应为 YYYY-MM-DD"), { statusCode: 400 });
  if (input.endsAt && !DATE.test(input.endsAt)) throw Object.assign(new Error("结束日期格式应为 YYYY-MM-DD"), { statusCode: 400 });
  const aliases = [...new Set((input.aliases ?? []).map((a) => a.trim()).filter(Boolean))];
  let row: { id: number } | undefined;
  try {
    [row] = await sql<{ id: number }[]>`
      INSERT INTO specials (public_id, slug, title, intro, starts_at, ends_at, cover_url, status)
      VALUES (${newUuid()}, ${slugOf(input)}, ${title}, ${input.intro?.trim() || null}, ${input.startsAt || null}, ${input.endsAt || null},
              ${input.coverUrl?.trim() || null}, 'draft')
      RETURNING id`;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw Object.assign(new Error("slug 已被占用"), { statusCode: 400 });
    throw error;
  }
  const id = row!.id;
  for (const alias of aliases) await sql`INSERT INTO special_aliases (special_id, alias) VALUES (${id}, ${alias}) ON CONFLICT DO NOTHING`;
  return id;
}

export interface UpdateSpecialInput {
  title?: string;
  intro?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  coverUrl?: string | null;
  status?: "draft" | "published" | "archived";
  aliases?: string[];
}

export async function updateSpecial(id: number, input: UpdateSpecialInput): Promise<SpecialRow | null> {
  const before = await loadSpecial(id);
  if (!before) return null;
  const title = input.title?.trim() || before.title;
  if (title.length < 2) throw Object.assign(new Error("专题标题太短"), { statusCode: 400 });
  if (input.startsAt && !DATE.test(input.startsAt)) throw Object.assign(new Error("开始日期格式应为 YYYY-MM-DD"), { statusCode: 400 });
  if (input.endsAt && !DATE.test(input.endsAt)) throw Object.assign(new Error("结束日期格式应为 YYYY-MM-DD"), { statusCode: 400 });
  await sql`UPDATE specials SET
      title = ${title},
      intro = ${input.intro === undefined ? before.intro : input.intro?.trim() || null},
      starts_at = ${input.startsAt === undefined ? dateOnly(before.starts_at) : input.startsAt || null},
      ends_at = ${input.endsAt === undefined ? dateOnly(before.ends_at) : input.endsAt || null},
      cover_url = ${input.coverUrl === undefined ? before.cover_url : input.coverUrl?.trim() || null},
      status = ${input.status ?? before.status},
      updated_at = now()
    WHERE id = ${id}`;
  if (input.aliases) {
    const aliases = [...new Set(input.aliases.map((a) => a.trim()).filter(Boolean))];
    await sql`DELETE FROM special_aliases WHERE special_id = ${id}`;
    for (const alias of aliases) await sql`INSERT INTO special_aliases (special_id, alias) VALUES (${id}, ${alias}) ON CONFLICT DO NOTHING`;
  }
  const after = await loadSpecial(id);
  if (after && (after.status === "published" || before.status === "published")) await syncMembership(after);
  return after;
}

export { attachManual, detach };
