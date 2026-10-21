// 公众号清单：一个 ghid 一个 mp_account 信源。名单由这里批量粘贴，检查由引擎的 mp 任务按频率做
// （有 Dajiala key 才真正请求）。凭据在设置页，这里只关心盯哪些号。
import { useState } from "react";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { HEALTH_LABEL } from "@aihot/web/features/admin/labels";
import { Badge, Button, ButtonLink, Card, DataTable, Field, Input, Select, Textarea, Time, healthTone } from "@aihot/web/features/admin/ui";
import { Avatar } from "./avatar";
import type { MpRow } from "./types";

const MODE_LABEL: Record<string, string> = { editorial: "进精选", hot_signal: "只作热度证据", isolated: "不上站" };

interface Draft {
  ghid: string;
  name: string;
  problem: string | null;
}

interface ImportResult {
  created: string[];
  duplicates: Array<{ ghid: string; sourceId: string; name: string }>;
  failed: Array<{ ghid: string; error: string }>;
}

/** 每行一个：ghid，或 ghid + 名称（空格、逗号、制表符都行）。 */
function parseLines(text: string): Draft[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = /^([^\s,，\t]+)[\s,，\t]+(.+)$/.exec(line);
    const ghid = (match?.[1] ?? line).trim();
    const name = (match?.[2] ?? "").trim();
    return {
      ghid,
      name,
      problem: /^[A-Za-z0-9_-]{3,80}$/.test(ghid) ? null : "ghid 只能包含字母、数字、下划线和连字符",
    };
  });
}

export function MpAccountsCard({ data }: { data: { total: number; dajiala: boolean; rows: MpRow[] } }) {
  const { run, pending } = useAdminAction();
  const [text, setText] = useState("");
  const [mode, setMode] = useState("editorial");
  const [tier, setTier] = useState("T2");
  const [minutes, setMinutes] = useState(60);
  const [result, setResult] = useState<ImportResult | null>(null);

  const drafts = parseLines(text);
  const invalid = drafts.filter((d) => d.problem);
  const add = async () => {
    const res = await run<ImportResult>("POST", "/api/admin/crawlers/mp-accounts", {
      accounts: drafts.map((d) => ({ ghid: d.ghid, name: d.name })),
      participationMode: mode,
      tier,
      intervalMinutes: minutes,
    }, { label: "mp-accounts" });
    if (res) {
      setText("");
      setResult(res);
    }
  };

  return (
    <Card
      title="公众号"
      right={
        <>
          {data.dajiala ? <Badge tone="ok">Dajiala key 已配置</Badge> : <Badge tone="warn">未配置 Dajiala key</Badge>}
          <ButtonLink to="/admin/settings" size="sm" tone="ghost">采集凭据</ButtonLink>
        </>
      }
    >
      {!data.dajiala && (
        <div className="mb-4 rounded-control bg-amber/10 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-amber/25">
          名单可以先建，但还没有 Dajiala key，引擎不会去检查这些公众号。配好 key 后按各自的频率自动开始。
        </div>
      )}
      <DataTable
        rows={data.rows}
        rowKey={(s) => s.source_id}
        empty="还没有公众号：在下面粘贴 ghid 名单，一行一个"
        columns={[
          {
            key: "name",
            label: "公众号",
            render: (s) => (
              <div className="flex min-w-[220px] items-center gap-2.5">
                <Avatar name={s.name} src={s.icon} />
                <div className="min-w-0">
                  <div className="font-medium text-ink">{s.name}</div>
                  <div className="font-mono text-[11.5px] text-ink-4">{s.ghid ?? s.source_id}</div>
                  {s.health === "failing" && s.last_error && <div className="mt-0.5 line-clamp-1 text-[12px] text-hot">{s.last_error}</div>}
                </div>
              </div>
            ),
          },
          { key: "mode", label: "参与", render: (s) => <span className="whitespace-nowrap">{MODE_LABEL[s.participation_mode] ?? s.participation_mode}<span className="ml-1 text-[11.5px] text-ink-4">{s.tier.replace("_", ".")}</span></span> },
          { key: "health", label: "状态", render: (s) => <Badge tone={s.enabled ? healthTone(s.health) : "muted"}>{s.enabled ? HEALTH_LABEL[s.health] ?? s.health : "已暂停"}</Badge> },
          { key: "interval", label: "间隔（分钟）", align: "right", render: (s) => s.interval_minutes },
          { key: "lastOk", label: "上次成功", render: (s) => <Time at={s.lastOkAt} /> },
          { key: "actions", label: "", align: "right", render: (s) => <ButtonLink to={`/admin/sources/${encodeURIComponent(s.source_id)}`} size="sm" tone="ghost">设置</ButtonLink> },
        ]}
      />

      <div className="mt-4 border-t border-line pt-4">
        <Field label="批量添加" hint="每行一个：ghid 名称（名称可省）。已存在的 ghid 会跳过，不会覆盖已有设置。">
          <Textarea rows={4} className="font-mono !text-[12.5px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={"gh_xxxxxxxx 42号车库\ngh_yyyyyyyy 电动星球"} spellCheck={false} />
        </Field>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="参与方式">
            <Select className="!w-[180px]" value={mode} onChange={(e) => setMode(e.target.value)}>
              {Object.entries(MODE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="等级">
            <Select className="!w-[120px]" value={tier} onChange={(e) => setTier(e.target.value)}>
              {["T1", "T1_5", "T2"].map((value) => <option key={value} value={value}>{value.replace("_", ".")}</option>)}
            </Select>
          </Field>
          <Field label="间隔（分钟）">
            <Input className="!w-[110px]" type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </Field>
          <div className="ml-auto flex items-center gap-3">
            {invalid.length > 0 && <span className="text-[12.5px] text-hot">{invalid[0]!.problem}（{invalid[0]!.ghid}）</span>}
            <Button tone="primary" busy={pending === "mp-accounts"} disabled={!drafts.length || invalid.length > 0} onClick={() => void add()}>
              {drafts.length ? `添加 ${drafts.length} 个公众号` : "添加公众号"}
            </Button>
          </div>
        </div>
        {result && (
          <div className="mt-3 space-y-1 text-[12.5px] text-ink-3">
            <div>新增 {result.created.length} 个；已存在跳过 {result.duplicates.length} 个；失败 {result.failed.length} 个。</div>
            {result.duplicates.length > 0 && <div className="text-ink-4">已存在：{result.duplicates.map((d) => d.name || d.ghid).join("、")}</div>}
            {result.failed.length > 0 && <div className="text-hot">{result.failed.map((f) => `${f.ghid}：${f.error}`).join("；")}</div>}
          </div>
        )}
      </div>
    </Card>
  );
}
