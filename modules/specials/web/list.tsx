import { Link, useLoaderData } from "react-router";
import type { SpecialsResponse } from "../types.ts";
import { SITE } from "@aihot/site";
import { cachedPage, loadOr404, pageHeaders } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { EmptyState } from "@aihot/web/components/ui/Page";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { tab: "hot", name: "专题" };
export { pageHeaders as headers };

export async function loader({ request }: { request: Request }) {
  return cachedPage(60, { specials: await loadOr404<SpecialsResponse>("/api/specials", { signal: request.signal }) });
}

export function meta() {
  return pageMeta({
    title: "专题",
    description: `${SITE.name} 的大会与系列专题：把同一主题下的多个独立事件放在一起读。`,
    path: "/specials",
  });
}

function range(startsAt: string | null, endsAt: string | null): string {
  if (startsAt && endsAt) return `${startsAt.replaceAll("-", ".")} – ${endsAt.replaceAll("-", ".")}`;
  return startsAt ?? endsAt ?? "持续更新";
}

export default function SpecialsPage() {
  const { specials } = useLoaderData<typeof loader>().specials;
  return (
    <div className="pb-14">
      <header className="pt-5 lg:pt-0">
        <p className="text-[12px] font-semibold tracking-[0.16em] text-accent">专题</p>
        <h1 className="mt-1.5 text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]">大会与系列专题</h1>
        <p className="mt-2 max-w-[640px] text-[14px] leading-[1.75] text-ink-3">
          同一场大会、同一系列发布下的多个独立事件，放在一个专题里读。专题不是热点榜：它不排名，只按主题聚合。
        </p>
      </header>

      {specials.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="还没有专题">后台「专题」里可以从大会候选创建；发布后会出现在这里。</EmptyState>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {specials.map((special) => (
            <Link key={special.slug} to={`/specials/${special.slug}`} className="card card-hover group flex min-w-0 flex-col overflow-hidden">
              {special.coverUrl && (
                <img src={special.coverUrl} alt="" className="h-40 w-full object-cover" loading="lazy" />
              )}
              <div className="flex min-w-0 flex-1 flex-col p-5">
                <div className="flex items-center gap-2 text-[12px] text-ink-4">
                  <span className="font-semibold text-accent">专题</span>
                  <span>{range(special.startsAt, special.endsAt)}</span>
                </div>
                <h2 className="mt-2 text-[18px] font-[650] leading-[1.45] text-ink transition-colors group-hover:text-accent">
                  {special.title}
                </h2>
                {(special.intro || special.digest) && (
                  <p className="mt-2 line-clamp-3 text-[13.5px] leading-[1.75] text-ink-3">{special.intro || special.digest}</p>
                )}
                <p className="mt-auto pt-4 text-[12px] text-ink-4">
                  <span className="num">{special.storyCount}</span> 个事件 · <span className="num">{special.reportCount}</span> 篇报道
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
