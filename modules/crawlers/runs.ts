import { sql } from "@aihot/backend/db";
import type { MpFetchRun } from "./registry.ts";

export const FETCH_RUN_PAGE_SIZE = 20;

export async function listFetchRuns(sourceId: string, page: number) {
  const current = Math.max(1, Math.floor(page) || 1);
  const [source] = await sql<{ id: string; name: string }[]>`SELECT id, name FROM sources WHERE id = ${sourceId}`;
  if (!source) return null;
  const [runs, [total]] = await Promise.all([
    sql<MpFetchRun[]>`
      SELECT id, started_at AS "startedAt", finished_at AS "finishedAt", status,
             found_count AS "foundCount", new_count AS "newCount", error, detail
      FROM fetch_runs WHERE source_id = ${sourceId}
      ORDER BY started_at DESC LIMIT ${FETCH_RUN_PAGE_SIZE} OFFSET ${(current - 1) * FETCH_RUN_PAGE_SIZE}`,
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM fetch_runs WHERE source_id = ${sourceId}`,
  ]);
  return { source, page: current, pageSize: FETCH_RUN_PAGE_SIZE, total: total!.total, runs };
}
