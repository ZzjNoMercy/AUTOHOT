// 设置页的「微博登录态」卡片：数据来自本模块 server.ts 的 admin.settings，保存仍走
// /api/admin/crawlers/credentials；和 Dajiala key 一起放在设置页的「采集凭据」下面。
import { useState } from "react";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { Badge, Button, Card, Field, Input, Textarea, Time } from "@aihot/web/features/admin/ui";

interface WeiboCredential {
  saved: boolean;
  from: "admin" | "env" | null;
  updatedAt: string | null;
  updatedBy: string | null;
  masked: Record<string, string> | null;
}

export default function WeiboCredentialsCard({ data }: { data: unknown }) {
  const { run, pending } = useAdminAction();
  const weibo = (data as { weibo?: WeiboCredential } | undefined)?.weibo;
  const [cookie, setCookie] = useState("");
  const [xsrfToken, setXsrfToken] = useState("");

  const save = () =>
    run("POST", "/api/admin/crawlers/credentials", { collector: "weibo", fields: { cookie, xsrfToken } }, {
      label: "crawler-credentials",
      success: "已保存，下一次抓取就用新的登录态",
    }).then((ok) => { if (ok) { setCookie(""); setXsrfToken(""); } });

  return (
    <Card
      className="mt-5"
      title="微博登录态"
      right={weibo?.saved ? <Badge tone="ok">{weibo.from === "env" ? "来自环境变量" : "已保存"}</Badge> : <Badge tone="warn">未设置</Badge>}
    >
      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-3">
        微博账号在「采集」页的账号名单里登记；这里只保存抓取用的登录态，过期后回来粘新的即可。
      </p>
      {weibo?.saved && (
        <div className="mb-4 space-y-0.5 text-[12.5px] text-ink-3">
          <div>cookie：<span className="font-mono">{weibo.masked?.cookie}</span></div>
          {weibo.masked?.xsrfToken && <div>XSRF token：<span className="font-mono">{weibo.masked.xsrfToken}</span></div>}
          <div>
            {weibo.updatedAt
              ? <>保存于 <Time at={weibo.updatedAt} />{weibo.updatedBy && <> · {weibo.updatedBy}</>}</>
              : "来自环境变量 WEIBO_COOKIE / WEIBO_XSRF_TOKEN"}
          </div>
        </div>
      )}
      <div className="grid gap-4">
        <Field label="cookie" hint="登录 weibo.com 后从浏览器开发者工具复制整条 cookie；过期后回来粘新的即可。">
          <Textarea rows={4} className="font-mono !text-[12.5px]" value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="SUB=…; SUBP=…; SSOLoginState=…" />
        </Field>
        <Field label="XSRF token" hint="同一处的 x-xsrf-token（与 cookie 里的 XSRF-TOKEN 一致）。">
          <Input className="max-w-[420px] font-mono" value={xsrfToken} onChange={(e) => setXsrfToken(e.target.value)} placeholder="-U-95ib93VtfZVvV6BAFMB31" />
        </Field>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3 border-t border-line pt-4">
        <span className="text-[12px] text-ink-4">保存后下一次抓取就用新的登录态。</span>
        <Button tone="primary" busy={pending === "crawler-credentials"} disabled={!cookie.trim() || !xsrfToken.trim()} onClick={() => void save()}>
          保存登录态
        </Button>
      </div>
    </Card>
  );
}
