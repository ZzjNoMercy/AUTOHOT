import { useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import type { AdminSpecialsResponse, SpecialCandidate } from "../types.ts";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, Empty, Field, Input, Textarea } from "@aihot/web/features/admin/ui";

function day(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

export async function loader({ request }: { request: Request }) {
  return adminGet<AdminSpecialsResponse>(request, "/api/admin/specials");
}

export default function AdminSpecialsPage() {
  const data = useLoaderData<typeof loader>();
  const { run, pending } = useAdminAction();
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: "", aliases: "", startsAt: "", endsAt: "", intro: "", slug: "" });

  const create = async (input: { title: string; aliases?: string[]; startsAt?: string | null; endsAt?: string | null; intro?: string | null; slug?: string }) => {
    const result = await run<{ id: number }>("POST", "/api/admin/specials", input, { success: "专题已创建（草稿），审核后发布" });
    if (result?.id) navigate(`/admin/specials/${result.id}`);
  };

  const submit = () => void create({
    title: form.title.trim(),
    slug: form.slug.trim() || undefined,
    aliases: form.aliases.split(/[,，\n]/).map((a) => a.trim()).filter(Boolean),
    startsAt: form.startsAt || null,
    endsAt: form.endsAt || null,
    intro: form.intro.trim() || null,
  });

  const fromCandidate = (c: SpecialCandidate) => void create({
    title: c.name,
    aliases: [c.name],
    startsAt: day(c.firstAt),
    endsAt: day(c.lastAt),
  });

  const ignore = (c: SpecialCandidate) => void run("POST", "/api/admin/specials/candidates/ignore", { key: c.key }, { success: "已忽略这个候选" });

  return (
    <AdminPage
      title="专题"
      subtitle="从大会候选里确认身份，人工发布；发布后按别名和日期窗口自动收进新的报道。专题不进热点榜。"
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card title="大会候选" right={<Badge tone="muted">{data.candidates.length}</Badge>}>
          {data.candidates.length === 0 ? <Empty>最近 14 天没有新的多人提及大会。阈值是至少 3 篇报道、3 个独立来源。</Empty> : (
            <ul className="divide-y divide-line-soft">
              {data.candidates.map((c) => (
                <li key={c.key} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-ink">{c.name}</p>
                    <p className="mt-0.5 text-[12px] text-ink-4">
                      <span className="num">{c.reportCount}</span> 篇 · <span className="num">{c.sourceCount}</span> 个来源
                      {c.firstAt && c.lastAt ? ` · ${day(c.firstAt)} – ${day(c.lastAt)}` : ""}
                    </p>
                    {c.samples[0] && <p className="mt-1 line-clamp-1 text-[12.5px] text-ink-3">{c.samples[0]}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" busy={pending === `POST /api/admin/specials`} onClick={() => fromCandidate(c)}>创建专题</Button>
                    <Button size="sm" tone="secondary" onClick={() => ignore(c)}>忽略</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="手工新建">
          <div className="grid gap-3">
            <Field label="名称"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：2026 奇瑞全球创新大会" /></Field>
            <Field label="slug" hint="留空自动生成；发布后不建议改"><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="chery-2026" /></Field>
            <Field label="别名" hint="逗号或换行分隔；标题本身自动算一个"><Textarea rows={3} value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="开始日期"><Input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
              <Field label="结束日期"><Input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
            </div>
            <Field label="导语" hint="可留空，发布后可由综述补上"><Textarea rows={3} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} /></Field>
            <Button busy={pending === "POST /api/admin/specials"} onClick={submit} disabled={!form.title.trim()}>创建草稿</Button>
          </div>
        </Card>
      </div>

      <Card title="已有专题" right={<Badge tone="muted">{data.specials.length}</Badge>}>
        {data.specials.length === 0 ? <Empty>还没有专题。</Empty> : (
          <ul className="divide-y divide-line-soft">
            {data.specials.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/specials/${s.id}`} className="text-[14px] font-semibold text-ink hover:text-accent">{s.title}</Link>
                  <p className="mt-0.5 text-[12px] text-ink-4">
                    <span className="font-mono">{s.slug}</span> · <span className="num">{s.storyCount}</span> 个事件 · <span className="num">{s.reportCount}</span> 篇报道
                  </p>
                </div>
                <Badge tone={s.status === "published" ? "ok" : s.status === "archived" ? "muted" : "warn"}>
                  {s.status === "published" ? "已发布" : s.status === "archived" ? "已归档" : "草稿"}
                </Badge>
                <Link to={`/admin/specials/${s.id}`} className="text-[13px] text-accent hover:underline">打开</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminPage>
  );
}
