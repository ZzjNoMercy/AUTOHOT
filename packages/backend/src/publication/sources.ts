// The source filter's list: each source with listed content, plus one row per platform. Counts are the
// same listed set the pool reads, so a chip never promises content its page would not show.
import { sql } from "../db.ts";
import { cached } from "../lib/cache.ts";
import { listedCondition } from "./scope.ts";
import type { SourceOption, SourcePlatformOption, SourcesResponse } from "@aihot/contracts/site";

const MAX_SOURCES = 60;

async function querySourceOptions(): Promise<SourcesResponse> {
  const rows = await sql<{ id: string; name: string; kind: string; n: number }[]>`
    SELECT s.id, s.name, s.kind, count(*)::int AS n
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE ${listedCondition(new Date())}
    GROUP BY s.id, s.name, s.kind
    ORDER BY n DESC, s.name, s.id
    LIMIT ${MAX_SOURCES}`;
  const platforms = new Map<string, number>();
  for (const row of rows) platforms.set(row.kind, (platforms.get(row.kind) ?? 0) + Number(row.n));
  const sources: SourceOption[] = rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, count: Number(row.n) }));
  const platformOptions: SourcePlatformOption[] = [...platforms.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return { sources, platforms: platformOptions };
}

const options = cached(querySourceOptions, { freshMs: 300_000, maxStaleMs: 600_000 });

export function loadSourceOptions(): Promise<SourcesResponse> {
  return options.get();
}
