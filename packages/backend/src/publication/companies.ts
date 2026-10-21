// The company filter's list: which companies have public content now, and how much.
// Businesses and people are not chosen here — the dictionary (industry/taxonomy.ts ENTITIES, or the
// admin's override of it) is; this only counts what the analysis named on listed items.
import type { CompanyOption, CompaniesResponse, EntityFilter } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { ENTITIES, entityIdentity, entityName } from "../editorial/vocabulary.ts";
import { cachedByKey } from "../lib/cache.ts";

/**
 * The company an address names, by its id or by any name readers know it by ("li", "理想汽车"). A name
 * the dictionary does not have stays as written: the page then shows the filter's own empty state
 * rather than a broken link.
 */
export function resolveCompany(value: string | null | undefined): EntityFilter | null {
  const named = (value ?? "").trim().slice(0, 60);
  if (!named) return null;
  const id = entityIdentity(named) ?? named;
  return { id, name: entityName(id) };
}

/** How far back the list looks. Long enough that a company with a quiet month still appears. */
const WINDOW_DAYS = 90;
/** The list is a browsing aid: it never grows past what a row of chips can hold. */
const MAX_COMPANIES = 24;

/**
 * The list for one board. The two boards count what they show: 全部动态 every listed item, 精选 the
 * selected ones — a chip that promised 11 items and opened a page with none would be worse than no
 * number at all.
 */
const lists = cachedByKey<"pool" | "featured", CompaniesResponse>(
  (board) => board,
  async (board) => {
    const rows = board === "featured"
      ? await sql<{ tag: string; n: number }[]>`
          SELECT t.tag, count(*)::int AS n
          FROM publications p, unnest(p.tags) AS t(tag)
          WHERE p.visibility = 'public' AND p.selected AND p.visible_after <= now() AND t.tag LIKE 'entity:%'
            AND p.timeline_at >= now() - make_interval(days => ${WINDOW_DAYS}::int)
          GROUP BY t.tag
          ORDER BY n DESC, t.tag`
      : await sql<{ tag: string; n: number }[]>`
          SELECT t.tag, count(*)::int AS n
          FROM publications p, unnest(p.tags) AS t(tag)
          WHERE p.visibility = 'public' AND p.eligible AND t.tag LIKE 'entity:%'
            AND p.timeline_at >= now() - make_interval(days => ${WINDOW_DAYS}::int)
          GROUP BY t.tag
          ORDER BY n DESC, t.tag`;
    const companies: CompanyOption[] = [];
    for (const row of rows) {
      const id = row.tag.slice("entity:".length);
      const entity = ENTITIES[id];
      // A company the dictionary no longer knows (the admin retired it) is not offered.
      if (!entity) continue;
      companies.push({ id, name: entity.name, count: Number(row.n) });
      if (companies.length >= MAX_COMPANIES) break;
    }
    return { companies };
  },
  { freshMs: 300_000, maxStaleMs: 600_000, maxKeys: 4 },
);

export function loadCompanyOptions(board: "pool" | "featured" = "pool"): Promise<CompaniesResponse> {
  return lists(board);
}
