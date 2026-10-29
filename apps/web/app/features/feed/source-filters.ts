import type { SourceOption, SourcePlatformOption } from "@aihot/contracts/site";
import { SOURCE_FILTERS } from "@aihot/site";

const PLATFORM_LABELS: Record<string, string> = {
  weibo: "微博", mp_account: "公众号", x_search: "X", rss: "RSS", web_list: "网页", json_list: "JSON", external: "外部上报",
};
export const platformLabel = (kind: string) => PLATFORM_LABELS[kind] ?? kind;

export function sourceFilterItems(sources: SourceOption[], platforms: SourcePlatformOption[]) {
  const platformItems = platforms
    .filter((p) => (p.kind === "weibo" || p.kind === "mp_account" || p.kind === "x_search") && SOURCE_FILTERS.platforms.includes(p.kind))
    .map((p) => ({ key: `kind:${p.kind}`, label: `${platformLabel(p.kind)} ${p.count}`, value: `kind:${p.kind}` }));
  const byId = new Map(sources.map((source) => [source.id, source]));
  const sourceItems = SOURCE_FILTERS.sources.flatMap((id) => {
    const source = byId.get(id);
    if (!source) return [];
    return [{ key: source.id, label: `${SOURCE_FILTERS.labels[source.id] ?? source.name} ${source.count}`, value: source.id }];
  });
  return [...platformItems, ...sourceItems];
}
