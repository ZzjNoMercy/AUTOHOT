// 微博清单：一个 uid 一个 weibo 源。登录态在设置页，这里只登记盯哪些账号。
import { useRef, useState } from "react";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { HEALTH_LABEL } from "@aihot/web/features/admin/labels";
import { Badge, Button, ButtonLink, Card, DataTable, Empty, Field, Input, Pager, Select, Time, healthTone } from "@aihot/web/features/admin/ui";
import { Avatar } from "./avatar";
import type { CredentialState, WeiboRow } from "./types";

const MODE_LABEL: Record<string, string> = { editorial: "进精选", hot_signal: "只作热度证据", isolated: "不上站" };
const WEIBO_UID = /^\d{5,20}$/;

/** 还没登记的账号；登记后它就是一行信源（ext-weibo-<uid>）。 */
interface Draft {
  key: string;
  uid: string;
  name: string;
}

/** 默认名单里还没登记的那些先铺成待登记的行；已经登记的不用再动。 */
function seedDrafts(defaults: Array<{ uid: string; name: string }>, rows: WeiboRow[]): Draft[] {
  const registered = new Set(rows.map((s) => s.account).filter((uid): uid is string => uid !== null));
  return defaults
    .filter((a) => !registered.has(a.uid))
    .map((a) => ({ key: `default-${a.uid}`, uid: a.uid, name: a.name }));
}

/** 整行空着当没填；其余每行的 uid 要合法、还没登记过、也不重复。 */
function draftsProblem(list: Draft[], registered: Set<string>): string | null {
  const seen = new Set<string>();
  for (const d of list) {
    const uid = d.uid.trim();
    if (!uid && !d.name.trim()) continue;
    if (!WEIBO_UID.test(uid)) return `「${uid || d.name.trim() || "空行"}」的 uid 要是 5～20 位数字`;
    if (registered.has(uid)) return `uid ${uid} 已经登记过了，先把它从这行移除`;
    if (seen.has(uid)) return `uid ${uid} 填了两次`;
    seen.add(uid);
  }
  return null;
}

export function WeiboAccountsCard({
  data, credential, defaults,
}: {
  data: { page: number; total: number; pageSize: number; rows: WeiboRow[] };
  credential: CredentialState;
  defaults: Array<{ uid: string; name: string }>;
}) {
  const { run, pending } = useAdminAction();
  const registered = new Set(data.rows.map((s) => s.account).filter((uid): uid is string => uid !== null));
  const [drafts, setDrafts] = useState<Draft[]>(() => seedDrafts(defaults, data.rows));
  // 账号帖子是内容：默认进精选，无关的交给预筛和相关度判定挡。
  const [mode, setMode] = useState("editorial");
  const [minutes, setMinutes] = useState(60);
  // 正在改头像的信源：URL 先放在这里，保存后才写进库。
  const [iconEdit, setIconEdit] = useState<{ id: string; url: string } | null>(null);
  const seq = useRef(0);

  // 空行当没填：不算进要登记的条数，也不拦着提交。
  const newDrafts = drafts.filter((d) => d.uid.trim() || d.name.trim());
  const problem = draftsProblem(newDrafts, registered);

  const patchDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const addDraft = () =>
    setDrafts((list) => [...list, { key: `new-${seq.current++}`, uid: "", name: "" }]);

  const saveIcon = (sourceId: string, url: string) =>
    run("POST", "/api/admin/crawlers/icon", { sourceId, iconUrl: url.trim() }, {
      label: "crawler-icon",
      success: url.trim() ? "头像已保存" : "已恢复自动头像，下次采集取账号当前头像",
    }).then((ok) => { if (ok) setIconEdit(null); });

  const registerAccounts = () =>
    run("POST", "/api/admin/crawlers/sources", {
      accounts: newDrafts.map((d) => ({ account: d.uid.trim(), name: d.name.trim() || d.uid.trim() })),
      participationMode: mode,
      intervalMinutes: minutes,
    }, { label: "crawler-sources", success: `已登记 ${newDrafts.length} 个微博账号` })
      .then((ok) => { if (ok) setDrafts([]); });

  return (
    <>
      <Card
        title="微博"
        right={
          <>
            {credential.saved ? <Badge tone="ok">{credential.from === "env" ? "登录态来自环境变量" : "登录态已保存"}</Badge> : <Badge tone="warn">登录态未设置</Badge>}
            <ButtonLink to="/admin/settings" size="sm" tone="ghost">登录态</ButtonLink>
          </>
        }
      >
        <DataTable
          rows={data.rows}
          rowKey={(s) => s.source_id}
          empty="还没有登记任何微博账号"
          columns={[
            {
              key: "name",
              label: "账号",
              render: (s) =>
                iconEdit?.id === s.source_id ? (
                  <div className="flex min-w-[320px] items-center gap-2">
                    <Input
                      autoFocus
                      aria-label={`${s.name} 的头像地址`}
                      placeholder="头像图片地址 https://…（留空恢复自动）"
                      value={iconEdit.url}
                      onChange={(e) => setIconEdit({ id: s.source_id, url: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveIcon(s.source_id, iconEdit.url);
                        if (e.key === "Escape") setIconEdit(null);
                      }}
                    />
                    <Button size="sm" tone="primary" busy={pending === "crawler-icon"} onClick={() => void saveIcon(s.source_id, iconEdit.url)}>保存</Button>
                    <Button size="sm" tone="ghost" onClick={() => setIconEdit(null)}>取消</Button>
                  </div>
                ) : (
                  <div className="flex min-w-[200px] items-center gap-2.5">
                    <Avatar name={s.name} src={s.icon} />
                    <div className="min-w-0">
                      <div className="font-medium text-ink">{s.name}</div>
                      <div className="font-mono text-[11.5px] text-ink-4">{s.source_id}</div>
                      {s.health === "failing" && s.last_error && <div className="mt-0.5 line-clamp-1 text-[12px] text-hot">{s.last_error}</div>}
                    </div>
                  </div>
                ),
            },
            { key: "mode", label: "参与", render: (s) => <span className="whitespace-nowrap">{MODE_LABEL[s.participation_mode] ?? s.participation_mode}<span className="ml-1 text-[11.5px] text-ink-4">{s.tier.replace("_", ".")}</span></span> },
            { key: "interval", label: "间隔（分钟）", align: "right", render: (s) => s.interval_minutes },
            { key: "health", label: "状态", render: (s) => <Badge tone={s.enabled ? healthTone(s.health) : "muted"}>{s.enabled ? HEALTH_LABEL[s.health] ?? s.health : "已暂停"}</Badge> },
            { key: "lastOk", label: "上次成功", render: (s) => <Time at={s.lastOkAt} /> },
            {
              key: "actions",
              label: "",
              render: (s) => (
                <div className="flex items-center justify-end gap-1">
                  <Button size="sm" tone="ghost" onClick={() => setIconEdit({ id: s.source_id, url: s.iconOverride ?? "" })}>头像</Button>
                  <ButtonLink to={`/admin/sources/${encodeURIComponent(s.source_id)}`} size="sm" tone="ghost">设置</ButtonLink>
                </div>
              ),
            },
          ]}
        />
        {/* 一页读完就再取下一页；总数来自模块自己的登记表。 */}
        <Pager page={data.page} hasMore={data.page * data.pageSize < data.total} />
      </Card>

      {/* 待登记的行不是信源：它们先在这儿填好、一起提交，登记完就变成上面的一行。 */}
      <Card
        title="待登记的微博账号"
        right={newDrafts.length ? `填好 ${newDrafts.length} 个账号再点登记` : "点「加一个微博账号」开始"}
      >
        {drafts.length ? (
          <DataTable
            rows={drafts}
            rowKey={(d) => d.key}
            columns={[
              {
                key: "account",
                label: "账号",
                render: (d) => (
                  <div className="flex min-w-[280px] items-center gap-2">
                    <Input className="!w-[132px] font-mono" aria-label="微博 uid" placeholder="uid" value={d.uid} onChange={(e) => patchDraft(d.key, { uid: e.target.value })} />
                    <Input aria-label="显示名" placeholder="显示名" value={d.name} onChange={(e) => patchDraft(d.key, { name: e.target.value })} />
                  </div>
                ),
              },
              { key: "mode", label: "参与方式", render: () => <span className="text-ink-4">{MODE_LABEL[mode]}</span> },
              { key: "interval", label: "间隔（分钟）", align: "right", render: () => <span className="text-ink-4">{minutes}</span> },
              { key: "health", label: "状态", render: () => <Badge tone="info">未登记</Badge> },
              { key: "lastOk", label: "上次成功", render: () => <span className="text-ink-4">—</span> },
              {
                key: "actions",
                label: "",
                render: (d) => <Button size="sm" tone="ghost" onClick={() => setDrafts((list) => list.filter((x) => x.key !== d.key))}>移除</Button>,
              },
            ]}
          />
        ) : (
          <Empty>没有待登记的账号：默认名单里的微博账号都已经登记，或还没点「加一个微博账号」。</Empty>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <Field label="新账号的参与方式">
            <Select className="!w-[190px]" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="hot_signal">只作热度证据</option>
              <option value="editorial">进精选</option>
              <option value="isolated">不上站</option>
            </Select>
          </Field>
          <Field label="新账号的抓取间隔（分钟）">
            <Input className="!w-[110px]" type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </Field>
          <Button tone="ghost" onClick={addDraft}>＋ 加一个微博账号</Button>
          <div className="ml-auto flex items-center gap-3">
            {problem && <span className="text-[12.5px] text-hot">{problem}</span>}
            <Button tone="primary" busy={pending === "crawler-sources"} disabled={!newDrafts.length || problem !== null} onClick={() => void registerAccounts()}>
              {newDrafts.length ? `登记 ${newDrafts.length} 个账号` : "登记账号"}
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
