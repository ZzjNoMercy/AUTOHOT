// Which public source a report belongs to. Accounts of one platform can share a source group, so
// readers see one source while each account stays a separate participant (and keeps its own tier,
// owner and selection). A source without a group is its own public source; Weibo accounts are grouped
// by kind so existing rows need no backfill.
import { SOURCE_GROUPS } from "@aihot/site";

export interface SourceIdentity {
  id: string;
  name: string;
  kind?: string;
  source_group_id?: string | null;
}

/** The group of a source, explicit first, then the platform kind. */
export function sourceGroupOf(source: SourceIdentity): string | null {
  return source.source_group_id || (source.kind === "weibo" ? "weibo" : null);
}

/** The key counted once per public source. */
export function sourceGroupKey(source: SourceIdentity): string {
  return sourceGroupOf(source) ?? source.id;
}

/** The name readers see for that source: the group's label, else the source's own name. */
export function sourceGroupName(source: SourceIdentity): string {
  const group = sourceGroupOf(source);
  return group ? SOURCE_GROUPS[group] ?? group : source.name;
}
