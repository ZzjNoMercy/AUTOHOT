// 后台「采集」页：按平台维护账号名单（公众号、微博）和话题订阅（财联社）。
// 凭据在设置页的「采集凭据」；每条信源的频率、分级、启停仍点进「信源」详情改。
// 只通过自己的接口读数据（模块的网页代码不 import 后端）。
import { Link, useSearchParams } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Time } from "@aihot/web/features/admin/ui";
import { SourceCollectionTabs } from "@aihot/web/features/admin/SourceCollectionTabs";
import { toast } from "@aihot/web/features/admin/toast";
import { PillTabs } from "@aihot/web/components/ui/Tabs";
import { MpAccountsCard } from "./mp";
import { WeiboAccountsCard } from "./weibo";
import { ClsTopicsCard } from "./topics";
import type { Overview, WereadAuthView } from "./types";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  return adminGet<Overview>(request, `/api/admin/crawlers${url.search}`);
}

type Tab = "mp" | "weibo" | "topics";

const AUTH_LABEL: Record<WereadAuthView["status"], string> = {
  missing: "未授权",
  pending: "等待扫码",
  valid: "已验证",
  invalid: "授权失效",
  unknown: "待确认",
};

function CollectionStatus({ data }: { data: Overview }) {
  const wereadAccounts = data.mp.rows.filter((row) => row.provider === "weread").length;
  return (
    <div className="mb-3 grid overflow-hidden rounded-panel bg-surface ring-1 ring-line sm:grid-cols-3" aria-label="采集接入状态">
      <div className="border-b border-line px-4 py-3 sm:border-b-0 sm:border-r">
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-ink-4"><span>微信读书</span><Link to="/admin/settings" className="text-accent">管理</Link></div>
        <div className="mt-1.5 flex items-center gap-2"><Badge tone={data.weread.status === "valid" ? "ok" : data.weread.status === "invalid" ? "warn" : "muted"}>{AUTH_LABEL[data.weread.status]}</Badge><span className="text-[12px] text-ink-3">{wereadAccounts} 个账号</span></div>
        <div className="mt-1 text-[11.5px] text-ink-4">{data.weread.validatedAt ? <>最近验证 <Time at={data.weread.validatedAt} /></> : "扫码后通过真实只读请求验证"}</div>
      </div>
      <div className="border-b border-line px-4 py-3 sm:border-b-0 sm:border-r">
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-ink-4"><span>Dajiala</span><Link to="/admin/settings" className="text-accent">管理</Link></div>
        <div className="mt-1.5"><Badge tone={data.mp.dajiala ? "ok" : "muted"}>{data.mp.dajiala ? "已配置" : "未配置"}</Badge></div>
        <div className="mt-1 text-[11.5px] text-ink-4">已有 ghid 账号的付费列表与正文</div>
      </div>
      <div className="px-4 py-3">
        <div className="text-[11.5px] text-ink-4">WeRead 读取能力</div>
        <div className="mt-1.5"><Badge tone="accent">latest-only</Badge></div>
        <div className="mt-1 text-[11.5px] text-ink-4">cover 最新一篇 + content 正文</div>
      </div>
    </div>
  );
}

export default function CrawlersPage({ loaderData }: { loaderData: Overview }) {
  const { run, pending } = useAdminAction();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "weibo" || tabParam === "topics" ? tabParam : "mp";
  const selectTab = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (key === "mp") next.delete("tab");
    else next.set("tab", key);
    next.delete("page");
    setSearchParams(next, { replace: true });
  };
  const topics = loaderData.cls?.topics ?? loaderData.defaults.clsTopics;

  const runAll = async () => {
    const result = await run<{ sources: number; created: number; failed: number; mp: number; weread: number; wereadSkipped: number }>(
      "POST", "/api/admin/crawlers/run", {}, { label: "crawler-run" },
    );
    if (result) {
      const skipped = result.wereadSkipped ? `；${result.wereadSkipped} 个 WeRead 账号未授权或受限` : "";
      toast(`微博/财联社 ${result.sources} 个源已抓；Dajiala ${result.mp} 个、WeRead ${result.weread} 个已排队${skipped}`, result.failed ? "error" : result.wereadSkipped ? "info" : "ok");
    }
  };

  return (
    <AdminPage
      title="采集"
      subtitle={<>按平台维护：公众号可用微信读书或 Dajiala，微博维护账号名单，财联社维护话题。密钥、登录态在 <Link to="/admin/settings" className="text-accent hover:underline">设置 → 采集凭据</Link>。</>}
      actions={<Button busy={pending === "crawler-run"} title="按各公众号自己的提供方排队；Dajiala 按请求计费" onClick={() => void runAll()}>全部抓一次</Button>}
    >
      <SourceCollectionTabs active="crawlers" />
      {tab === "mp" && <CollectionStatus data={loaderData} />}
      {tab === "mp" && <p className="mb-5 text-[12px] leading-relaxed text-ink-4"><b className="font-medium text-ink-3">WeRead 仅监测最新一篇，可能漏采。</b>两次检查之间连续发布多篇时，不能补回中间历史；不会修改远端书架或关注关系。</p>}
      <div className="mb-5">
        <PillTabs
          items={[
            { key: "mp", label: "公众号", count: loaderData.mp.total },
            { key: "weibo", label: "微博", count: loaderData.weibo.total },
            { key: "topics", label: "话题", count: topics.length },
          ]}
          active={tab}
          onSelect={selectTab}
          layoutId="admin-collect"
          size="sm"
          label="采集视图"
        />
      </div>

      {/* 三块都留着，切 tab 不会丢掉还没提交的名单。 */}
      <div className={tab === "mp" ? "" : "hidden"}><MpAccountsCard data={loaderData.mp} weread={loaderData.weread} /></div>
      <div className={tab === "weibo" ? "" : "hidden"}><WeiboAccountsCard data={loaderData.weibo} credential={loaderData.credential} defaults={loaderData.defaults.weiboAccounts} /></div>
      <div className={tab === "topics" ? "" : "hidden"}><ClsTopicsCard cls={loaderData.cls} catalog={loaderData.defaults.clsTopics} /></div>
    </AdminPage>
  );
}
