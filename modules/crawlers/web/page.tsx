// 后台「采集」页：按平台维护账号名单（公众号、微博）和话题订阅（财联社）。
// 凭据在设置页的「采集凭据」；每条信源的频率、分级、启停仍点进「信源」详情改。
// 只通过自己的接口读数据（模块的网页代码不 import 后端）。
import { useState } from "react";
import { Link } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Button } from "@aihot/web/features/admin/ui";
import { toast } from "@aihot/web/features/admin/toast";
import { PillTabs } from "@aihot/web/components/ui/Tabs";
import { MpAccountsCard } from "./mp";
import { WeiboAccountsCard } from "./weibo";
import { ClsTopicsCard } from "./topics";
import type { Overview } from "./types";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  return adminGet<Overview>(request, `/api/admin/crawlers${url.search}`);
}

type Tab = "accounts" | "topics";

export default function CrawlersPage({ loaderData }: { loaderData: Overview }) {
  const { run, pending } = useAdminAction();
  const [tab, setTab] = useState<Tab>("accounts");
  const topics = loaderData.cls?.topics ?? loaderData.defaults.clsTopics;
  const accounts = loaderData.mp.total + loaderData.weibo.total;

  const runAll = async () => {
    const result = await run<{ sources: number; created: number; failed: number; mp: number }>(
      "POST", "/api/admin/crawlers/run", {}, { label: "crawler-run" },
    );
    if (result) toast(`微博/财联社 ${result.sources} 个源已抓；公众号 ${result.mp} 个已排队（按请求计费）`, result.failed ? "error" : "ok");
  };

  return (
    <AdminPage
      title="采集"
      subtitle={<>按平台维护要盯的账号和话题。密钥、登录态在 <Link to="/admin/settings" className="text-accent hover:underline">设置 → 采集凭据</Link>；频率、分级、启停点每行的「设置」进信源详情改。</>}
      actions={
        <Button busy={pending === "crawler-run"} title="微博/财联社立即抓一轮；公众号会调用极致了（按请求计费）" onClick={() => void runAll()}>
          全部抓一次
        </Button>
      }
    >
      <div className="mb-5">
        <PillTabs
          items={[
            { key: "accounts", label: "账号", count: accounts },
            { key: "topics", label: "话题", count: topics.length },
          ]}
          active={tab}
          onSelect={(key) => setTab(key as Tab)}
          layoutId="admin-collect"
          size="sm"
          label="采集视图"
        />
      </div>

      {/* 两个视图都留着，切 tab 不会丢掉还没提交的名单。 */}
      <div className={tab === "accounts" ? "" : "hidden"}>
        <div className="grid gap-5">
          <MpAccountsCard data={loaderData.mp} />
          <WeiboAccountsCard data={loaderData.weibo} credential={loaderData.credential} defaults={loaderData.defaults.weiboAccounts} />
        </div>
      </div>
      <div className={tab === "topics" ? "" : "hidden"}>
        <ClsTopicsCard cls={loaderData.cls} catalog={loaderData.defaults.clsTopics} />
      </div>
    </AdminPage>
  );
}
