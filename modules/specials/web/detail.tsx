import { Link, useLoaderData } from "react-router";
import type { SpecialResponse } from "../types.ts";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { monthDayTime } from "@aihot/web/lib/format";
import { ReadingLayout } from "@aihot/web/components/ui/Page";
import type { Screen } from "@aihot/web/components/shell/screens";
import { SITE } from "@aihot/site";

export const handle: Screen = { tab: "hot", name: "专题" };
export { pageHeaders as headers };

export async function loader({ request, params }: { request: Request; params: { slug?: string } }) {
  const special = await loadOr404<SpecialResponse>(`/api/specials/${encodeURIComponent(params.slug ?? "")}`, { signal: request.signal });
  return cachedPage(60, { special });
}

export function meta({ data }: { data?: { special: SpecialResponse } | null }) {
  const s = data?.special?.special;
  return pageMeta({
    title: s?.title ?? "专题",
    description: s?.intro ?? s?.digest ?? `${SITE.name} 专题：把同一主题下的多个独立事件放在一起读。`,
    path: s ? `/specials/${s.slug}` : "/specials",
  });
}

function range(startsAt: string | null, endsAt: string | null): string {
  if (startsAt && endsAt) return `${startsAt.replaceAll("-", ".")} – ${endsAt.replaceAll("-", ".")}`;
  return startsAt ?? endsAt ?? "持续更新";
}

export default function SpecialDetailPage() {
  const { special } = useLoaderData<typeof loader>();
  const s = special.special;
  return (
    <ReadingLayout
      aside={
        <div className="space-y-4">
          <section className="card p-5">
            <h2 className="text-[13px] font-semibold text-ink">专题数据</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
              <div><dt className="text-ink-4">事件</dt><dd className="num mt-0.5 text-[18px] font-semibold text-ink">{s.storyCount}</dd></div>
              <div><dt className="text-ink-4">报道</dt><dd className="num mt-0.5 text-[18px] font-semibold text-ink">{s.reportCount}</dd></div>
              <div><dt className="text-ink-4">来源</dt><dd className="num mt-0.5 text-[18px] font-semibold text-ink">{s.sourceCount}</dd></div>
              <div><dt className="text-ink-4">时间</dt><dd className="mt-0.5 text-[13px] text-ink-2">{range(s.startsAt, s.endsAt)}</dd></div>
            </dl>
          </section>
          {s.participants.length > 0 && (
            <section className="card p-5">
              <h2 className="text-[13px] font-semibold text-ink">参与来源</h2>
              <p className="mt-2 text-[12.5px] leading-[1.8] text-ink-3">{s.participants.join("、")}</p>
            </section>
          )}
          <Link to="/hot" className="block text-[13px] text-ink-3 transition-colors hover:text-accent">← 回热点榜</Link>
        </div>
      }
    >
      <article className="pb-10">
        <header className="pt-5 lg:pt-0">
          <div className="flex items-center gap-2 text-[12px] text-ink-4">
            <span className="font-semibold text-accent">专题</span>
            <span>{range(s.startsAt, s.endsAt)}</span>
          </div>
          <h1 className="mt-2 text-[25px] font-bold leading-[1.35] tracking-[-0.01em] text-ink lg:text-[30px]">{s.title}</h1>
          {s.intro && <p className="mt-3 text-[15px] leading-[1.85] text-ink-2">{s.intro}</p>}
        </header>

        {s.digest && (
          <section className="mt-5 rounded-card bg-bg-sunk/70 px-5 py-4 text-[14.5px] leading-[1.9] text-ink-2 ring-1 ring-inset ring-line-soft">
            {s.digest.split(/\n{2,}/).map((p, i) => <p key={i} className={i ? "mt-2.5" : ""}>{p}</p>)}
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-[13px] font-semibold text-ink-3">事件时间线</h2>
          <ol className="mt-3 space-y-3">
            {s.timeline.map((item) => (
              <li key={item.storyPublicId ?? item.latestAt} className="card p-4">
                <div className="flex items-start gap-3">
                  <span className="mono shrink-0 pt-0.5 text-[11.5px] text-ink-4">{monthDayTime(item.latestAt)}</span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold leading-[1.55] text-ink">
                      {item.storyPublicId ? (
                        <Link to={`/story/${item.storyPublicId}`} className="transition-colors hover:text-accent">{item.title}</Link>
                      ) : item.title}
                    </h3>
                    <p className="mt-1 text-[12px] text-ink-4">
                      <span className="num">{item.reportCount}</span> 篇报道 · <span className="num">{item.sourceCount}</span> 个来源
                    </p>
                    {item.report && (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-[1.7] text-ink-3">
                        {item.report.sourceName}：{item.report.title}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-8">
          <h2 className="text-[13px] font-semibold text-ink-3">全部报道</h2>
          <ul className="mt-2 divide-y divide-line-soft border-y border-line-soft">
            {s.reports.map((r) => (
              <li key={r.id} className="py-2.5">
                <Link to={r.storyPublicId ? `/story/${r.storyPublicId}` : `/items/${r.id}`} className="text-[13.5px] leading-[1.7] text-ink-2 transition-colors hover:text-accent">
                  {r.title}
                </Link>
                <span className="ml-2 text-[12px] text-ink-4">{r.sourceName} · {monthDayTime(r.publishedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </ReadingLayout>
  );
}
