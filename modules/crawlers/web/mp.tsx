// 公众号名单：文章链接接入 WeRead，已有 ghid 账号继续使用 Dajiala；所有状态来自后端。
import { useState } from "react";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { toast } from "@aihot/web/features/admin/toast";
import { HEALTH_LABEL } from "@aihot/web/features/admin/labels";
import { Badge, Button, ButtonLink, Card, DataTable, Field, Input, KV, ReasonDialog, Select, Textarea, Time, healthTone } from "@aihot/web/features/admin/ui";
import { Sheet } from "@aihot/web/components/ui/Sheet";
import { Avatar } from "./avatar";
import { FetchRunBadge } from "./run-utils";
import type { MpRow, WereadAddResult, WereadArticle, WereadAuthView, WereadPreview, WereadQueueResult } from "./types";

const MODE_LABEL: Record<string, string> = { editorial: "进精选", hot_signal: "只作热度证据", isolated: "不上站" };
const ERROR_LABEL: Record<string, string> = {
  auth_required: "需要先完成微信读书授权",
  rate_limited: "微信读书正在访问冷却，请稍后再试",
  already_queued: "任务已在队列中",
};

interface Draft { ghid: string; name: string; problem: string | null }
interface ImportResult {
  created: string[];
  duplicates: Array<{ ghid: string; sourceId: string; name: string }>;
  failed: Array<{ ghid: string; error: string }>;
}

function parseLines(text: string): Draft[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = /^([^\s,，\t]+)[\s,，\t]+(.+)$/.exec(line);
    const ghid = (match?.[1] ?? line).trim();
    const name = (match?.[2] ?? "").trim();
    return { ghid, name, problem: /^[A-Za-z0-9_-]{3,80}$/.test(ghid) ? null : "ghid 只能包含字母、数字、下划线和连字符" };
  });
}

function AccountStatus({ account, weread }: { account: MpRow; weread: WereadAuthView }) {
  if (!account.enabled) return <Badge tone="muted">已暂停</Badge>;
  if (account.provider === "weread") {
    if (weread.status === "invalid") return <Badge tone="warn">授权失效</Badge>;
    if (weread.status === "unknown") return <Badge tone="warn">会话待确认</Badge>;
    if (account.wereadStatus === "pending_validation") return <Badge tone="warn">{weread.status === "valid" ? "待验证" : "待授权"}</Badge>;
    if (weread.status === "missing" || weread.status === "pending") return <Badge tone="warn">待授权</Badge>;
    if (account.capability === "blocked") return <Badge tone="warn">读取受限</Badge>;
  }
  return <Badge tone={healthTone(account.health)}>{HEALTH_LABEL[account.health] ?? account.health}</Badge>;
}

function Method({ account }: { account: MpRow }) {
  return account.provider === "weread"
    ? <div className="flex flex-wrap gap-1"><Badge tone="accent">WeRead</Badge><Badge>仅最新一篇</Badge></div>
    : <Badge>Dajiala</Badge>;
}

function ArticleBodyStatus({ article }: { article: WereadArticle }) {
  if (article.bodyStatus === "ok" || article.contentStatus === "ready") return <Badge tone="ok">正文已取得</Badge>;
  if (article.contentStatus === "failed" || article.bodyStatus === "none") return <Badge tone="bad">正文失败</Badge>;
  return <Badge tone="warn">正文待读取</Badge>;
}

export function MpAccountsCard({ data, weread }: { data: { total: number; dajiala: boolean; rows: MpRow[] }; weread: WereadAuthView }) {
  const { run, pending } = useAdminAction();
  const [text, setText] = useState("");
  const [mode, setMode] = useState("editorial");
  const [tier, setTier] = useState("T2");
  const [minutes, setMinutes] = useState(60);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState<WereadPreview | null>(null);
  const [addMode, setAddMode] = useState("editorial");
  const [addTier, setAddTier] = useState("T2");
  const [addMinutes, setAddMinutes] = useState(60);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);

  const detail = data.rows.find((row) => row.source_id === detailId) ?? null;
  const rows = pendingOnly ? data.rows.filter((row) =>
    row.wereadStatus === "pending_validation" || row.capability === "blocked" || row.health === "failing" || row.health === "degraded"
    || (row.provider === "weread" && weread.status !== "valid")
  ) : data.rows;
  const drafts = parseLines(text);
  const invalid = drafts.filter((draft) => draft.problem);

  const importGhid = async () => {
    const res = await run<ImportResult>("POST", "/api/admin/crawlers/mp-accounts", {
      accounts: drafts.map((draft) => ({ ghid: draft.ghid, name: draft.name })), participationMode: mode, tier, intervalMinutes: minutes,
    }, { label: "mp-accounts" });
    if (res) {
      setText("");
      setResult(res);
    }
  };

  const resolve = async () => {
    setPreview(null);
    const res = await run<WereadPreview>("POST", "/api/admin/crawlers/weread/resolve", { articleUrl: link.trim() }, { label: "weread-resolve", revalidate: false });
    if (res) setPreview(res);
  };

  const start = async () => {
    const res = await run<WereadAddResult>("POST", "/api/admin/crawlers/weread/accounts", {
      articleUrl: link.trim(), participationMode: addMode, tier: addTier, intervalMinutes: addMinutes,
    }, { label: "weread-add" });
    if (!res) return;
    if (!res.created) {
      setAddOpen(false);
      if (res.duplicate) setDetailId(res.duplicate.sourceId);
      toast("这个公众号已在监测列表中", "info");
      return;
    }
    setAddOpen(false);
    if (res.sourceId) setDetailId(res.sourceId);
    if (res.authRequired) toast("已保存为待验证账号，请到「设置 → 采集凭据」完成扫码", "info");
    else if (res.status === "pending_validation") toast("已保存为待验证账号；首次观测尚未完成，可稍后重试", "info");
    else if (res.check?.contentStatus === "failed") toast("已添加并保存最新文章；正文待补读", "info");
    else toast("已添加公众号，首次观测已保存", "ok");
  };

  const check = async (account: MpRow) => {
    const res = await run<WereadQueueResult>("POST", `/api/admin/crawlers/weread/accounts/${encodeURIComponent(account.source_id)}/check`, {}, { label: `weread-check-${account.source_id}` });
    if (!res) return;
    toast(res.queued ? `已加入「${account.name}」检查队列` : ERROR_LABEL[res.reason ?? ""] ?? "暂时不能检查", res.queued ? "ok" : "info");
  };

  const retryBody = async (article: WereadArticle) => {
    const res = await run<WereadQueueResult>("POST", `/api/admin/crawlers/weread/articles/${encodeURIComponent(article.id)}/retry-body`, {}, { label: `weread-body-${article.id}` });
    if (res) toast(res.queued ? "正文补读已加入队列" : ERROR_LABEL[res.reason ?? ""] ?? "暂时不能补读", res.queued ? "ok" : "info");
  };

  return (
    <>
      <Card
        title={<span>公众号 <span className="ml-1 text-[12px] font-normal text-ink-4">{data.total} 个</span></span>}
        right={
          <>
            {data.dajiala ? <Badge tone="ok">Dajiala 已配置</Badge> : <Badge>Dajiala 未配置</Badge>}
            <Button size="sm" tone={pendingOnly ? "secondary" : "ghost"} onClick={() => setPendingOnly(!pendingOnly)}>{pendingOnly ? "查看全部账号" : "只看异常账号"}</Button>
            <ButtonLink to="/admin/settings" size="sm" tone="ghost">采集凭据</ButtonLink>
            <Button size="sm" tone="primary" onClick={() => { setPreview(null); setAddOpen(true); }}>添加公众号</Button>
          </>
        }
      >
        {!data.dajiala && data.rows.some((row) => row.provider === "dajiala") && (
          <div className="mb-4 rounded-control bg-amber/10 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-amber/25">
            已有 Dajiala 账号尚未配置 key，不会执行付费检查；这不影响 WeRead 账号。
          </div>
        )}
        <DataTable
          rows={rows}
          rowKey={(account) => account.source_id}
          empty={pendingOnly ? "当前没有异常账号" : "还没有公众号，点击「添加公众号」粘贴一篇文章链接"}
          onRowClick={(account) => setDetailId(account.source_id)}
          columns={[
            {
              key: "name", label: "公众号", render: (account) => (
                <div className="flex min-w-[220px] items-center gap-2.5">
                  <Avatar name={account.name} src={account.icon} />
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{account.name}</div>
                    <div className="truncate font-mono text-[11.5px] text-ink-4">{account.bookId ?? account.ghid ?? account.source_id}</div>
                    {account.last_error && <div className="mt-0.5 max-w-[300px] truncate text-[12px] text-amber" title={account.last_error}>{account.last_error}</div>}
                  </div>
                </div>
              ),
            },
            { key: "method", label: "接入", render: (account) => <Method account={account} /> },
            { key: "status", label: "状态", render: (account) => <AccountStatus account={account} weread={weread} /> },
            {
              key: "latest", label: "最新文章", render: (account) => account.articles[0]
                ? <div className="max-w-[280px]"><div className="truncate text-[12.5px]" title={account.articles[0].title}>{account.articles[0].title}</div><div className="mt-0.5 text-[11.5px] text-ink-4">首次发现 <Time at={account.articles[0].firstSeenAt} /></div></div>
                : <span className="text-ink-4">—</span>,
            },
            { key: "check", label: "上次检查", render: (account) => <div><Time at={account.lastCheckedAt} /><div className="mt-0.5 text-[11.5px] text-ink-4">每 {account.interval_minutes} 分钟</div></div> },
            { key: "actions", label: "", align: "right", render: (account) => <Button size="sm" tone="ghost" onClick={(event) => { event.stopPropagation(); setDetailId(account.source_id); }}>详情</Button> },
          ]}
        />

        <details className="mt-4 border-t border-line pt-4">
          <summary className="cursor-pointer text-[12.5px] text-ink-3">已有 ghid？批量导入 Dajiala 账号</summary>
          <div className="mt-4">
            <Field label="批量添加" hint="每行一个：ghid 名称（名称可省）。已存在的 ghid 会跳过，不会覆盖已有设置；列表与正文按请求计费。">
              <Textarea rows={4} className="font-mono !text-[12.5px]" value={text} onChange={(event) => setText(event.target.value)} placeholder={"gh_xxxxxxxx 42号车库\ngh_yyyyyyyy 电动星球"} spellCheck={false} />
            </Field>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label="参与方式"><Select className="!w-[180px]" value={mode} onChange={(event) => setMode(event.target.value)}>{Object.entries(MODE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
              <Field label="等级"><Select className="!w-[120px]" value={tier} onChange={(event) => setTier(event.target.value)}>{["T1", "T1_5", "T2"].map((value) => <option key={value} value={value}>{value.replace("_", ".")}</option>)}</Select></Field>
              <Field label="间隔（分钟）"><Input className="!w-[110px]" type="number" min={1} max={1440} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></Field>
              <div className="ml-auto flex items-center gap-3">
                {invalid.length > 0 && <span className="text-[12.5px] text-hot">{invalid[0]!.problem}</span>}
                <Button tone="primary" busy={pending === "mp-accounts"} disabled={!drafts.length || invalid.length > 0} onClick={() => void importGhid()}>{drafts.length ? `添加 ${drafts.length} 个公众号` : "添加公众号"}</Button>
              </div>
            </div>
            {result && <div className="mt-3 space-y-1 text-[12.5px] text-ink-3"><div>新增 {result.created.length} 个；已存在跳过 {result.duplicates.length} 个；失败 {result.failed.length} 个。</div>{result.failed.length > 0 && <div className="text-hot">{result.failed.map((item) => `${item.ghid}：${item.error}`).join("；")}</div>}</div>}
          </div>
        </details>
      </Card>

      <Sheet centered open={addOpen} onClose={() => setAddOpen(false)} title="添加公众号" label="添加公众号">
        <div className="space-y-5 px-5 pb-5">
          <p className="text-[12.5px] leading-relaxed text-ink-3">用一篇文章识别账号；之后只用保存的 bookId 检查。仅监测最新一篇，可能漏采。</p>
          {!preview ? (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void resolve(); }}>
              <Field label="文章链接" hint="支持短链和带 __biz 的长链；只接受 mp.weixin.qq.com 官方文章地址。">
                <Input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://mp.weixin.qq.com/s/…" spellCheck={false} />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="参与方式"><Select value={addMode} onChange={(event) => setAddMode(event.target.value)}>{Object.entries(MODE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
                <Field label="等级"><Select value={addTier} onChange={(event) => setAddTier(event.target.value)}>{["T1", "T1_5", "T2"].map((value) => <option key={value} value={value}>{value.replace("_", ".")}</option>)}</Select></Field>
                <Field label="间隔（分钟）"><Input type="number" min={1} max={1440} value={addMinutes} onChange={(event) => setAddMinutes(Number(event.target.value))} /></Field>
              </div>
              <div className="flex justify-end border-t border-line pt-4"><Button type="submit" tone="primary" busy={pending === "weread-resolve"} disabled={!link.trim()}>解析公众号</Button></div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-panel bg-surface-2 p-4 ring-1 ring-line">
                <div className="flex items-center gap-3"><Avatar name={preview.name ?? preview.resolved.bookId} src={null} /><div><div className="font-semibold text-ink">{preview.name ?? preview.resolved.bookId}</div><div className="mt-1 text-[12px] text-ink-4">{preview.status === "active" ? "微信读书已验证 · 只读" : "已解析账号 · 待能力验证"}</div></div></div>
                <div className="mt-4"><KV items={[["bookId", <span className="font-mono text-[12px]">{preview.resolved.bookId}</span>], ["biz", <span className="break-all font-mono text-[12px]">{preview.resolved.biz}</span>], ["原文", <a className="break-all text-accent" href={preview.resolved.articleUrl} target="_blank" rel="noreferrer">查看输入文章</a>]]} /></div>
                {preview.latest && <div className="mt-4 border-t border-line pt-3"><div className="text-[11.5px] text-ink-4">微信读书返回的最新一篇</div><div className="mt-1 text-[13px] leading-relaxed text-ink-2">{preview.latest.title}</div><div className="mt-1 text-[11.5px] text-ink-4">{preview.latest.publishedAt ? <Time at={preview.latest.publishedAt} /> : "原始发布时间未知"}</div></div>}
              </div>
              {preview.duplicate && <div className="rounded-control bg-amber/10 px-3 py-2.5 text-[12.5px] text-ink-2 ring-1 ring-amber/25">这个公众号已经存在，不会重复创建。</div>}
              {preview.message && <div className="rounded-control bg-amber/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-amber/25">{preview.message}。仍可先保存为待验证账号，授权恢复后无需重新添加。</div>}
              <div className="rounded-control bg-bg-sunk px-3 py-2.5 text-[12px] leading-relaxed text-ink-3">添加后使用微信读书 cover 检查最新一篇、content 读取正文；不会修改远端书架或关注关系。</div>
              <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
                <Button tone="ghost" onClick={() => setPreview(null)}>返回修改</Button>
                {preview.duplicate
                  ? <Button tone="primary" onClick={() => { setAddOpen(false); setDetailId(preview.duplicate!.sourceId); }}>打开已有账号</Button>
                  : <Button tone="primary" busy={pending === "weread-add"} onClick={() => void start()}>{preview.status === "active" ? "开始监测" : "保存为待验证"}</Button>}
              </div>
            </div>
          )}
        </div>
      </Sheet>

      <Sheet centered open={detail !== null} onClose={() => setDetailId(null)} title={detail?.name ?? "公众号详情"} label="公众号详情">
        {detail && <div className="space-y-5 px-5 pb-5">
          <div className="flex flex-wrap items-center gap-2"><AccountStatus account={detail} weread={weread} /><Method account={detail} /></div>
          {detail.provider === "weread" && weread.status !== "valid" && <div className="rounded-control bg-amber/10 px-3 py-3 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-amber/25">当前没有已验证的微信读书会话。账号和文章会保留，恢复授权后继续检查。<span className="ml-2 inline-flex"><ButtonLink to="/admin/settings" size="sm">去扫码</ButtonLink></span></div>}
          <KV items={[
            ["bookId", detail.bookId ? <span className="break-all font-mono text-[12px]">{detail.bookId}</span> : null],
            ["biz", detail.biz ? <span className="break-all font-mono text-[12px]">{detail.biz}</span> : null],
            ["ghid", detail.ghid ? <span className="font-mono text-[12px]">{detail.ghid}</span> : null],
            ["来源文章", detail.sourceArticleUrl ? <a className="break-all text-accent" href={detail.sourceArticleUrl} target="_blank" rel="noreferrer">打开原文</a> : null],
            ["监测", detail.provider === "weread" ? "仅最新一篇，可能漏采" : "Dajiala 最新一页"],
            ["设置", `${MODE_LABEL[detail.participation_mode] ?? detail.participation_mode} · ${detail.tier.replace("_", ".")} · 每 ${detail.interval_minutes} 分钟`],
            ["上次检查", <Time at={detail.lastCheckedAt} />],
            ["最近成功", <Time at={detail.lastOkAt} />],
          ]} />
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-medium text-ink-3">最近检查记录</h3>
              <ButtonLink to={`/admin/crawlers/runs/${encodeURIComponent(detail.source_id)}`} size="sm" tone="ghost">查看全部</ButtonLink>
            </div>
            {detail.runs.length ? <div className="space-y-2">{detail.runs.slice(0, 5).map((run) => (
              <div key={run.id} className="rounded-control bg-bg-sunk/60 px-3 py-2.5 ring-1 ring-line">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2"><FetchRunBadge run={run} />{run.detail?.reason && <span className="text-[11.5px] text-ink-4">{run.detail.reason === "schedule" ? "定时检查" : "手动检查"}</span>}</div>
                  <Time at={run.startedAt} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-4">
                  <span>读取 {run.foundCount} 篇</span>
                  <span>入库 {run.newCount} 篇</span>
                  {run.detail?.contentStatus && <span>{run.detail.contentStatus === "ready" ? "正文已取得" : "正文失败"}</span>}
                </div>
                {run.error && <p className="mt-1.5 break-words text-[12px] leading-relaxed text-hot">{run.error}</p>}
              </div>
            ))}</div> : <p className="text-[12.5px] text-ink-4">还没有检查记录。</p>}
          </section>
          <section>
            <h3 className="mb-2 text-[12px] font-medium text-ink-3">最近文章</h3>
            {detail.articles.length ? <div className="space-y-2">{detail.articles.map((article) => (
              <article key={article.id} className="rounded-control bg-bg-sunk/70 p-3 ring-1 ring-line">
                <a href={article.url} target="_blank" rel="noreferrer" className="text-[13px] leading-relaxed text-ink-2 hover:text-accent">{article.title}</a>
                <div className="mt-1 text-[11.5px] text-ink-4">{article.publishedAt ? <>发布于 <Time at={article.publishedAt} /></> : "原始发布时间未知"} · 首次发现 <Time at={article.firstSeenAt} /></div>
                <div className="mt-2 flex flex-wrap items-center gap-2"><ArticleBodyStatus article={article} />{detail.provider === "weread" && article.bodyStatus !== "ok" && <Button size="sm" tone="ghost" busy={pending === `weread-body-${article.id}`} onClick={() => void retryBody(article)}>补读正文</Button>}</div>
                {article.contentError && <p className="mt-2 text-[12px] leading-relaxed text-hot">{article.contentError}</p>}
              </article>
            ))}</div> : <p className="text-[12.5px] text-ink-4">还没有观测到文章。</p>}
          </section>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            <Button size="md" tone="ghost" onClick={() => setPauseOpen(true)}>{detail.enabled ? "暂停监测" : "恢复监测"}</Button>
            <div className="flex items-center gap-2"><ButtonLink to={`/admin/sources/${encodeURIComponent(detail.source_id)}`} size="md">信源设置</ButtonLink>{detail.provider === "weread" && <Button size="md" tone="primary" busy={pending === `weread-check-${detail.source_id}`} onClick={() => void check(detail)}>立即检查</Button>}</div>
          </div>
        </div>}
      </Sheet>

      {detail && <ReasonDialog
        open={pauseOpen}
        title={detail.enabled ? "暂停这个公众号" : "恢复这个公众号"}
        description="只改变本地监测状态，已有文章保留，不会修改微信或微信读书关注关系。"
        confirmLabel={detail.enabled ? "暂停" : "恢复"}
        danger={detail.enabled}
        busy={pending === "toggle-weread-source"}
        onClose={() => setPauseOpen(false)}
        onSubmit={async (reason) => {
          const res = await run("PATCH", `/api/admin/sources/${encodeURIComponent(detail.source_id)}`, {
            patch: { enabled: !detail.enabled }, version: new Date(detail.updatedAt).toISOString(), reason,
          }, { label: "toggle-weread-source", success: detail.enabled ? "已暂停" : "已恢复" });
          return res !== null;
        }}
      />}
    </>
  );
}
