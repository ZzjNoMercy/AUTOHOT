// 微博清单：一个 uid 一个 weibo 源。登录态在设置页，这里只登记盯哪些账号。
import { useRef, useState } from "react";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { HEALTH_LABEL } from "@aihot/web/features/admin/labels";
import { Badge, Button, ButtonLink, Card, DataTable, Field, Input, Pager, ReasonDialog, Select, Time, healthTone } from "@aihot/web/features/admin/ui";
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
function seedDrafts(defaults: Array<{ uid: string; name: string }>, registered: string[]): Draft[] {
  const known = new Set(registered);
  return defaults
    .filter((a) => !known.has(a.uid))
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
  data: { page: number; total: number; pageSize: number; registered: string[]; rows: WeiboRow[] };
  credential: CredentialState;
  defaults: Array<{ uid: string; name: string }>;
}) {
  const { run, pending } = useAdminAction();
  const registered = new Set(data.registered);
  const [drafts, setDrafts] = useState<Draft[]>(() => seedDrafts(defaults, data.registered));
  // 账号帖子是内容：默认进精选，无关的交给预筛和相关度判定挡。
  const [mode, setMode] = useState("editorial");
  const [minutes, setMinutes] = useState(60);
  const [addOpen, setAddOpen] = useState(false);
  // 正在改头像的信源：URL 先放在这里，保存后才写进库。
  const [iconEdit, setIconEdit] = useState<{ id: string; url: string } | null>(null);
  const seq = useRef(0);

  // 空行当没填：不算进要登记的条数，也不拦着提交。
  const newDrafts = drafts.filter((d) => d.uid.trim() || d.name.trim());
  const problem = draftsProblem(newDrafts, registered);
  const pages = Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize)));

  const patchDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const addDraft = () =>
    setDrafts((list) => [...list, { key: `new-${seq.current++}`, uid: "", name: "" }]);
  const openAdd = () => {
    if (!drafts.length) addDraft();
    setAddOpen(true);
  };

  const saveIcon = (sourceId: string, url: string) =>
    run("POST", "/api/admin/crawlers/icon", { sourceId, iconUrl: url.trim() }, {
      label: "crawler-icon",
      success: url.trim() ? "头像已保存" : "已恢复自动头像，下次采集取账号当前头像",
    }).then((ok) => { if (ok) setIconEdit(null); });

  const registerAccounts = async () => {
    const result = await run("POST", "/api/admin/crawlers/sources", {
      accounts: newDrafts.map((d) => ({ account: d.uid.trim(), name: d.name.trim() || d.uid.trim() })),
      participationMode: mode,
      intervalMinutes: minutes,
    }, { label: "crawler-sources", success: `已登记 ${newDrafts.length} 个微博账号` });
    if (result === null) return false;
    setDrafts([]);
    return true;
  };

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] text-ink-4">
            共 <span className="num text-ink-2">{data.total}</span> 个账号
            {pages > 1 && <> · 第 <span className="num">{data.page}</span> / <span className="num">{pages}</span> 页</>}
          </p>
          <Button size="sm" tone="primary" onClick={openAdd}>＋ 添加账号</Button>
        </div>
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
        <Pager page={data.page} hasMore={data.page * data.pageSize < data.total} total={data.total} pageSize={data.pageSize} />
      </Card>

      {/* 登记不是审计动作，弹窗里不要备注框；默认名单里没登记的账号先铺好。 */}
      <ReasonDialog
        open={addOpen}
        title="添加微博账号"
        description="uid 是微博主页地址里的数字。每个账号登记后是一条独立信源，按下面的方式和间隔采集。"
        confirmLabel={newDrafts.length ? `登记 ${newDrafts.length} 个账号` : "登记账号"}
        showNote={false}
        confirmDisabled={!newDrafts.length || problem !== null}
        busy={pending === "crawler-sources"}
        onClose={() => setAddOpen(false)}
        onSubmit={() => registerAccounts()}
      >
        <div className="space-y-2">
          <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
            {drafts.map((d) => (
              <div key={d.key} className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)_auto] items-center gap-2">
                <Input
                  className="font-mono"
                  aria-label="微博 uid"
                  placeholder="uid"
                  value={d.uid}
                  onChange={(e) => patchDraft(d.key, { uid: e.target.value })}
                />
                <Input
                  aria-label="显示名"
                  placeholder="显示名（留空用 uid）"
                  value={d.name}
                  onChange={(e) => patchDraft(d.key, { name: e.target.value })}
                />
                <Button
                  size="sm"
                  tone="ghost"
                  aria-label="移除这一行"
                  onClick={() => setDrafts((list) => list.filter((x) => x.key !== d.key))}
                >
                  移除
                </Button>
              </div>
            ))}
          </div>
          <Button size="sm" tone="ghost" onClick={addDraft}>＋ 再加一行</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="参与方式">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="hot_signal">只作热度证据</option>
              <option value="editorial">进精选</option>
              <option value="isolated">不上站</option>
            </Select>
          </Field>
          <Field label="抓取间隔（分钟）">
            <Input type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </Field>
        </div>
        {problem ? (
          <p className="text-[12.5px] leading-relaxed text-hot">{problem}</p>
        ) : (
          <p className="text-[12px] leading-relaxed text-ink-4">默认名单里还没登记的账号已经列在上面；也可以填新的 uid。</p>
        )}
      </ReasonDialog>
    </>
  );
}
