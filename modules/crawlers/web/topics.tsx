// 财联社话题：它按话题订阅，不是账号名单。选中的话题存在 ext-cls 这条源上，
// 采集时只抓选中的；没选过就按默认的五个。
import { useState } from "react";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { HEALTH_LABEL } from "@aihot/web/features/admin/labels";
import { Badge, Button, ButtonLink, Card, Field, Input, Time, healthTone } from "@aihot/web/features/admin/ui";
import type { ClsRow, Topic } from "./types";

export function ClsTopicsCard({ cls, catalog }: { cls: ClsRow | null; catalog: Topic[] }) {
  const { run, pending } = useAdminAction();
  const [topics, setTopics] = useState<Topic[]>(() => (cls?.topics ?? catalog).map((t) => ({ ...t })));
  const [customId, setCustomId] = useState("");
  const [customName, setCustomName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const has = (id: string) => topics.some((t) => t.id === id);
  const known = new Set(catalog.map((t) => t.id));
  const custom = topics.filter((t) => !known.has(t.id));

  const toggle = (topic: Topic) => {
    setError(null);
    setTopics((list) => (list.some((t) => t.id === topic.id) ? list.filter((t) => t.id !== topic.id) : [...list, { ...topic }]));
  };

  const addCustom = () => {
    const id = customId.trim();
    const name = customName.trim();
    if (!/^\d{1,10}$/.test(id)) return setError("话题 ID 要是 1～10 位数字");
    if (!name) return setError("给自定义话题起个名字");
    if (has(id)) return setError("这个话题已经选过了");
    setTopics((list) => [...list, { id, name }]);
    setCustomId("");
    setCustomName("");
    setError(null);
  };

  const save = () => run("POST", "/api/admin/crawlers/topics", { topics }, {
    label: "cls-topics",
    success: "话题已保存，下一轮按选中的抓",
  }).then((ok) => { if (ok) setError(null); });

  return (
    <Card
      title="财联社话题"
      right={cls ? <Badge tone={cls.enabled ? healthTone(cls.health) : "muted"}>{cls.enabled ? HEALTH_LABEL[cls.health] ?? cls.health : "已暂停"}</Badge> : <Badge tone="info">尚未建立信源</Badge>}
    >
      <p className="text-[12.5px] leading-relaxed text-ink-3">
        财联社按话题抓快讯；同一篇可能同时挂在多个话题下，入库时按地址去重。勾选要盯的话题，保存后下一轮采集生效。
      </p>

      {cls ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
          <span>每 {cls.interval_minutes} 分钟检查一次</span>
          <span>上次成功 <Time at={cls.lastOkAt} /></span>
          {cls.last_error && <span className="text-hot">{cls.last_error}</span>}
          <ButtonLink to={`/admin/sources/${encodeURIComponent(cls.source_id)}`} size="sm" tone="ghost">信源设置</ButtonLink>
        </div>
      ) : (
        <div className="mt-3 text-[12.5px] text-ink-4">还没有财联社信源；保存话题时会自动建立 <span className="font-mono">ext-cls</span>。</div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.map((topic) => (
          <label key={topic.id} className="flex cursor-pointer items-center gap-2.5 rounded-control bg-bg-sunk px-3 py-2 ring-1 ring-line-soft transition-colors hover:ring-line">
            <input type="checkbox" className="size-4 shrink-0 accent-[var(--accent)]" checked={has(topic.id)} onChange={() => toggle(topic)} />
            <span className="min-w-0 flex-1 text-[13px] text-ink">{topic.name}</span>
            <span className="font-mono text-[11.5px] text-ink-4">{topic.id}</span>
          </label>
        ))}
      </div>

      {custom.length > 0 && (
        <div className="mt-3 space-y-2">
          {custom.map((topic) => (
            <div key={topic.id} className="flex items-center gap-3 rounded-control bg-bg-sunk px-3 py-2 text-[13px] ring-1 ring-line-soft">
              <span className="min-w-0 flex-1 text-ink">{topic.name}</span>
              <span className="font-mono text-[11.5px] text-ink-4">{topic.id}</span>
              <Button size="sm" tone="ghost" onClick={() => setTopics((list) => list.filter((t) => t.id !== topic.id))}>移除</Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <Field label="自定义话题 ID">
          <Input className="!w-[120px] font-mono" value={customId} onChange={(e) => setCustomId(e.target.value)} placeholder="1090" />
        </Field>
        <Field label="名称">
          <Input className="!w-[180px]" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="芯片" />
        </Field>
        <Button tone="ghost" onClick={addCustom}>＋ 添加话题</Button>
        <div className="ml-auto flex items-center gap-3">
          {error && <span className="text-[12.5px] text-hot">{error}</span>}
          <span className="text-[12px] text-ink-4">已选 {topics.length} 个话题</span>
          <Button tone="primary" busy={pending === "cls-topics"} disabled={!topics.length} onClick={() => void save()}>保存话题</Button>
        </div>
      </div>
    </Card>
  );
}
