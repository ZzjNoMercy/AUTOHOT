import { adminGet } from "@aihot/web/lib/admin.server";
import { AdminPage, ButtonLink, Card, DataTable, Pager, Time } from "@aihot/web/features/admin/ui";
import { FetchRunBadge } from "./run-utils";
import type { MpFetchRun } from "./types";

interface RunsData {
  source: { id: string; name: string };
  page: number;
  pageSize: number;
  total: number;
  runs: MpFetchRun[];
}

export async function loader({ request, params }: { request: Request; params: { sourceId: string } }) {
  const url = new URL(request.url);
  return adminGet<RunsData>(request, `/api/admin/crawlers/runs/${encodeURIComponent(params.sourceId)}${url.search}`);
}

export default function CrawlerRunsPage({ loaderData }: { loaderData: RunsData }) {
  const { source, runs, page, pageSize, total } = loaderData;
  return (
    <AdminPage
      title={`${source.name} · 检查记录`}
      subtitle="每次检查的读取、入库和正文结果，按时间倒序排列。"
      back={{ to: "/admin/crawlers", label: "返回账号采集" }}
      actions={<ButtonLink to={`/admin/sources/${encodeURIComponent(source.id)}`}>信源设置</ButtonLink>}
    >
      <Card pad={false}>
        <DataTable
          rows={runs}
          rowKey={(run) => run.id}
          empty="还没有检查记录"
          columns={[
            { key: "time", label: "时间", render: (run) => <Time at={run.startedAt} /> },
            { key: "status", label: "结果", render: (run) => <FetchRunBadge run={run} /> },
            { key: "reason", label: "方式", render: (run) => run.detail?.reason === "schedule" ? "定时检查" : "手动检查" },
            { key: "found", label: "读取", align: "right", render: (run) => `${run.foundCount} 篇` },
            { key: "new", label: "入库", align: "right", render: (run) => `${run.newCount} 篇` },
            { key: "content", label: "正文", render: (run) => run.detail?.contentStatus ? (run.detail.contentStatus === "ready" ? "已取得" : "失败") : "—" },
            { key: "error", label: "错误", render: (run) => run.error ? <span className="inline-block max-w-[520px] break-words text-hot">{run.error}</span> : <span className="text-ink-4">—</span> },
          ]}
        />
      </Card>
      <Pager page={page} hasMore={page * pageSize < total} total={total} pageSize={pageSize} />
    </AdminPage>
  );
}
