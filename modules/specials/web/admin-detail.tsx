import { useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import type { AdminSpecialResponse } from "../types.ts";
import { adminGet } from "@aihot/web/lib/admin.server";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { AdminPage, Badge, Button, Card, Empty, Field, Input, Select, Textarea } from "@aihot/web/features/admin/ui";

export async function loader({ request, params }: { request: Request; params: { id?: string } }) {
  return adminGet<AdminSpecialResponse>(request, `/api/admin/specials/${encodeURIComponent(params.id ?? "")}`);
}

type Draft = {
  title: string; intro: string; aliases: string; startsAt: string; endsAt: string; coverUrl: string; status: "draft" | "published" | "archived";
};

function draftOf(s: AdminSpecialResponse["special"]): Draft {
  return {
    title: s.title, intro: s.intro ?? "", aliases: s.aliases.join("\n"), startsAt: s.startsAt ?? "", endsAt: s.endsAt ?? "",
    coverUrl: s.coverUrl ?? "", status: s.status,
  };
}

export default function AdminSpecialDetailPage() {
  const { special } = useLoaderData<typeof loader>();
  const { run, pending } = useAdminAction();
  const [draft, setDraft] = useState<Draft>(() => draftOf(special));
  const [forVersion, setForVersion] = useState(special.updatedAt);
  const [articleId, setArticleId] = useState("");
  if (forVersion !== special.updatedAt) {
    setForVersion(special.updatedAt);
    setDraft(draftOf(special));
  }
  useEffect(() => { setForVersion(special.updatedAt); setDraft(draftOf(special)); }, [special.updatedAt]);

  const patch = (body: Record<string, unknown>, label: string, success?: string) =>
    run("PATCH", `/api/admin/specials/${special.id}`, body, { label, success });

  const save = () => void patch({
    title: draft.title.trim(),
    intro: draft.intro.trim() || null,
    aliases: draft.aliases.split(/[,，\n]/).map((a) => a.trim()).filter(Boolean),
    startsAt: draft.startsAt || null,
    endsAt: draft.endsAt || null,
    coverUrl: draft.coverUrl.trim() || null,
    status: draft.status,
  }, "special-save", "已保存");

  const attach = async () => {
    const result = await run("POST", `/api/admin/specials/${special.id}/attach`, { articleId: articleId.trim() }, { success: "已加入专题" });
    if (result) setArticleId("");
  };

  return (
    <AdminPage
      back={{ to: "/admin/specials", label: "专题列表" }}
      title={special.title}
      subtitle={<><span className="font-mono">{special.slug}</span> · {special.storyCount} 个事件 · {special.reportCount} 篇报道</>}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" busy={pending === "special-sync"} onClick={() => void run("POST", `/api/admin/specials/${special.id}/sync`, {}, { label: "special-sync", success: "已重新匹配" })}>重新匹配</Button>
          <Button size="sm" busy={pending === "special-digest"} onClick={() => void run("POST", `/api/admin/specials/${special.id}/digest`, {}, { label: "special-digest", success: "综述已排队" })}>重写综述</Button>
          {special.status !== "published"
            ? <Button size="sm" onClick={() => void patch({ status: "published" }, "special-publish", "已发布")}>发布</Button>
            : <Button size="sm" tone="secondary" onClick={() => void patch({ status: "draft" }, "special-unpublish", "已转为草稿")}>转草稿</Button>}
        </div>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card title="设置" right={<Badge tone={special.status === "published" ? "ok" : special.status === "archived" ? "muted" : "warn"}>{special.status === "published" ? "已发布" : special.status === "archived" ? "已归档" : "草稿"}</Badge>}>
          <div className="grid gap-3">
            <Field label="名称"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            <Field label="别名" hint="标题本身自动算一个；一行一个"><Textarea rows={3} value={draft.aliases} onChange={(e) => setDraft({ ...draft, aliases: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="开始日期"><Input type="date" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></Field>
              <Field label="结束日期"><Input type="date" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} /></Field>
            </div>
            <Field label="封面图 URL"><Input value={draft.coverUrl} onChange={(e) => setDraft({ ...draft, coverUrl: e.target.value })} placeholder="https://…" /></Field>
            <Field label="导语" hint="可手写；综述会单独显示"><Textarea rows={4} value={draft.intro} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} /></Field>
            <div className="flex items-center gap-3">
              <Field label="状态">
                <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft["status"] })}>
                  <option value="draft">草稿</option>
                  <option value="published">已发布</option>
                  <option value="archived">已归档</option>
                </Select>
              </Field>
              <Button className="mt-6" busy={pending === "special-save"} onClick={save}>保存</Button>
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card title="综述" right={special.digest ? <Badge tone="ok">有</Badge> : <Badge tone="muted">无</Badge>}>
            {special.digest ? <div className="whitespace-pre-line text-[13.5px] leading-[1.85] text-ink-2">{special.digest}</div> : <Empty>发布并匹配到报道后，综述会在后台任务里生成。</Empty>}
          </Card>
          <Card title="手工加入报道">
            <div className="flex gap-2">
              <Input value={articleId} onChange={(e) => setArticleId(e.target.value)} placeholder="报道 id" />
              <Button busy={pending === "special-attach"} onClick={() => void attach()} disabled={!articleId.trim()}>加入</Button>
            </div>
          </Card>
        </div>
      </div>

      <Card title="成员报道" right={<Badge tone="muted">{special.reports.length}</Badge>}>
        {special.reports.length === 0 ? <Empty>还没有报道。发布后会按别名和日期窗口自动匹配。</Empty> : (
          <ul className="divide-y divide-line-soft">
            {special.reports.map((r) => (
              <li key={r.articleId} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] text-ink-2">{r.title}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-4">
                    {r.sourceName} · {r.publishedAt.slice(0, 10)} · {r.source === "manual" ? "人工" : "自动"}
                    {r.selected ? " · 精选" : ""}
                  </p>
                </div>
                <Button size="sm" tone="secondary" onClick={() => void run("POST", `/api/admin/specials/${special.id}/detach`, { articleId: r.articleId }, { success: "已移出专题" })}>移出</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AdminPage>
  );
}
