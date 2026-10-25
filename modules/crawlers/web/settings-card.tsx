// 设置页的采集凭据：微信读书扫码与微博登录态；完整 Cookie 只存在服务端。
import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { useAdminAction } from "@aihot/web/features/admin/action";
import { toast } from "@aihot/web/features/admin/toast";
import { Badge, Button, Card, Field, Input, Textarea, Time } from "@aihot/web/features/admin/ui";
import { Sheet } from "@aihot/web/components/ui/Sheet";
import type { WereadAuthView } from "./types";

interface WeiboCredential {
  saved: boolean;
  from: "admin" | "env" | null;
  updatedAt: string | null;
  updatedBy: string | null;
  masked: Record<string, string> | null;
}

type LoginStatus = "starting" | "pending" | "validating" | "succeeded" | "expired" | "failed" | "superseded";
interface LoginFlow { flowId: string; qrSvg: string; expiresAt: string }
interface LoginResult { status: Exclude<LoginStatus, "starting">; errorCode: string | null; auth: WereadAuthView; resumed: number }

const AUTH_LABEL: Record<WereadAuthView["status"], string> = { missing: "未授权", pending: "等待扫码", valid: "已验证", invalid: "授权失效", unknown: "待确认" };
const LOGIN_ERROR: Record<string, string> = {
  login_not_found: "登录流程不存在，请重新扫码",
  login_timeout: "二维码已过期，请重新扫码",
  need_otp: "微信要求额外验证码，当前流程无法继续",
  login_rejected: "扫码确认未完成，请重新扫码",
  auth_invalid: "扫码后的会话没有通过只读验证，请重试",
  start_failed: "暂时无法创建二维码，请稍后重试",
};

function WereadLoginSheet({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: (auth: WereadAuthView) => void }) {
  const { run, pending } = useAdminAction();
  const [restart, setRestart] = useState(0);
  const [flow, setFlow] = useState<LoginFlow | null>(null);
  const [status, setStatus] = useState<LoginStatus>("starting");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    const controller = new AbortController();
    setFlow(null);
    setStatus("starting");
    setErrorCode(null);

    const pause = async (ms: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });

    const execute = async () => {
      const started = await run<LoginFlow>("POST", "/api/admin/crawlers/weread/login", {}, { label: "weread-login", revalidate: false });
      if (stopped) return;
      if (!started) {
        setStatus("failed");
        setErrorCode("start_failed");
        return;
      }
      setFlow(started);
      setStatus("pending");

      while (!stopped) {
        try {
          const res = await fetch(`/api/admin/crawlers/weread/login/${encodeURIComponent(started.flowId)}`, { credentials: "same-origin", signal: controller.signal });
          if (res.status === 401) {
            window.location.href = `/api/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`;
            return;
          }
          const result = await res.json() as LoginResult & { detail?: string };
          if (!res.ok) throw new Error(result.detail ?? "查询扫码状态失败");
          if (stopped) return;
          setStatus(result.status);
          setErrorCode(result.errorCode === "LOGIN_TIMEOUT" ? null : result.errorCode);
          if (result.status === "succeeded") {
            toast(`微信读书已验证${result.resumed ? `，${result.resumed} 个待验证账号已排队` : ""}`, "ok");
            successRef.current(result.auth);
            return;
          }
          if (result.status === "expired" || result.status === "failed" || result.status === "superseded") return;
          await pause(1500);
        } catch (error) {
          if (stopped || controller.signal.aborted) return;
          setErrorCode(error instanceof Error ? error.message : "transient");
          await pause(2500);
        }
      }
    };
    void execute();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [open, restart]);

  const terminal = status === "succeeded" || status === "expired" || status === "failed" || status === "superseded";
  return (
    <Sheet open={open} onClose={onClose} title="登录微信读书" centered label="登录微信读书">
      <div className="px-5 pb-5 text-center">
        <p className="text-[12.5px] leading-relaxed text-ink-3">用微信扫码并确认。候选会话通过真实只读验证后才保存；不会修改书架或关注关系。</p>
        <div className="mx-auto mt-4 grid size-[232px] place-items-center rounded-panel bg-white p-3 ring-1 ring-line">
          {flow
            ? <img className="size-full" src={`data:image/svg+xml;utf8,${encodeURIComponent(flow.qrSvg)}`} alt="微信读书登录二维码" />
            : <span className="size-6 animate-spin rounded-full border-2 border-[#202a30] border-r-transparent" aria-label="正在创建二维码" />}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          {status === "succeeded" ? <Badge tone="ok">验证成功</Badge> : terminal ? <Badge tone="warn">需要重新扫码</Badge> : <Badge tone="accent">{status === "validating" ? "正在验证会话" : "等待扫码确认"}</Badge>}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-4">
          {status === "succeeded" ? "会话已保存，可以关闭此窗口。" : errorCode ? LOGIN_ERROR[errorCode] ?? "扫码状态暂时无法确认，会继续尝试；也可关闭后重试。" : flow ? `二维码有效期至 ${new Date(flow.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "正在创建真实二维码…"}
        </p>
        <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
          <Button tone="ghost" onClick={onClose}>{status === "succeeded" ? "完成" : "取消"}</Button>
          {terminal && status !== "succeeded" && <Button tone="primary" busy={pending === "weread-login"} onClick={() => setRestart((value) => value + 1)}>重新扫码</Button>}
        </div>
      </div>
    </Sheet>
  );
}

function WereadCredentialsCard({ weread }: { weread?: WereadAuthView }) {
  const { run, pending } = useAdminAction();
  const revalidator = useRevalidator();
  const [qrOpen, setQrOpen] = useState(false);
  const status = weread?.status ?? "missing";

  const validate = async () => {
    const result = await run<{ auth: WereadAuthView; resumed: number }>("POST", "/api/admin/crawlers/weread/validate", {}, { label: "weread-validate" });
    if (!result) return;
    toast(result.auth.status === "valid" ? `微信读书会话有效${result.resumed ? `，${result.resumed} 个账号已排队` : ""}` : result.auth.status === "invalid" ? "会话已失效，请重新扫码" : "暂时无法确认会话，请稍后再试", result.auth.status === "valid" ? "ok" : result.auth.status === "invalid" ? "error" : "info");
  };

  return (
    <>
      <Card
        className="mt-5"
        title="微信读书会话"
        right={<Badge tone={status === "valid" ? "ok" : status === "invalid" || status === "unknown" ? "warn" : "muted"}>{AUTH_LABEL[status]}</Badge>}
      >
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-3">用于公众号最新一篇发现和正文读取。仅监测最新一篇，可能漏采；扫码属于当前微信读书账号，不需要各公众号管理员授权。</p>
        <div className="mb-4 space-y-1 text-[12.5px] text-ink-3">
          {weread?.maskedVid && <div>wr_vid：<span className="font-mono">{weread.maskedVid}</span></div>}
          <div>{weread?.validatedAt ? <>最近验证 <Time at={weread.validatedAt} /></> : "尚未通过真实只读请求验证"}</div>
          {weread?.blockedUntil && Date.parse(weread.blockedUntil) > Date.now() && <div className="text-amber">读取受限，冷却至 <Time at={weread.blockedUntil} />；不会密集重试。</div>}
          {weread?.lastErrorCode && <div className="text-ink-4">最近状态码：{weread.lastErrorCode}</div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-[12px] leading-relaxed text-ink-4">会话只保存在服务端；失效后保留账号与文章，重新扫码即可恢复。</span>
          <div className="flex gap-2">
            <Button tone="ghost" busy={pending === "weread-validate"} disabled={status === "missing" || status === "pending"} onClick={() => void validate()}>验证会话</Button>
            <Button tone="primary" onClick={() => setQrOpen(true)}>{status === "valid" ? "重新扫码" : "扫码授权"}</Button>
          </div>
        </div>
      </Card>
      <WereadLoginSheet open={qrOpen} onClose={() => setQrOpen(false)} onSuccess={() => { setQrOpen(false); revalidator.revalidate(); }} />
    </>
  );
}

function WeiboCredentialsCard({ data }: { data: unknown }) {
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
      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-3">微博账号在「采集 → 微博」页登记；这里只保存抓取用的登录态，过期后回来粘新的即可。</p>
      {weibo?.saved && <div className="mb-4 space-y-0.5 text-[12.5px] text-ink-3"><div>cookie：<span className="font-mono">{weibo.masked?.cookie}</span></div>{weibo.masked?.xsrfToken && <div>XSRF token：<span className="font-mono">{weibo.masked.xsrfToken}</span></div>}<div>{weibo.updatedAt ? <>保存于 <Time at={weibo.updatedAt} />{weibo.updatedBy && <> · {weibo.updatedBy}</>}</> : "来自环境变量 WEIBO_COOKIE / WEIBO_XSRF_TOKEN"}</div></div>}
      <div className="grid gap-4">
        <Field label="cookie" hint="登录 weibo.com 后从浏览器开发者工具复制整条 cookie；过期后回来粘新的即可。"><Textarea rows={4} className="font-mono !text-[12.5px]" value={cookie} onChange={(event) => setCookie(event.target.value)} placeholder="SUB=…; SUBP=…; SSOLoginState=…" /></Field>
        <Field label="XSRF token" hint="同一处的 x-xsrf-token（与 cookie 里的 XSRF-TOKEN 一致）。"><Input className="max-w-[420px] font-mono" value={xsrfToken} onChange={(event) => setXsrfToken(event.target.value)} placeholder="-U-95ib93VtfZVvV6BAFMB31" /></Field>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3 border-t border-line pt-4"><span className="text-[12px] text-ink-4">保存后下一次抓取就用新的登录态。</span><Button tone="primary" busy={pending === "crawler-credentials"} disabled={!cookie.trim() || !xsrfToken.trim()} onClick={() => void save()}>保存登录态</Button></div>
    </Card>
  );
}

export default function CrawlerCredentialsCards({ data }: { data: unknown }) {
  const weread = (data as { weread?: WereadAuthView } | undefined)?.weread;
  return <><WereadCredentialsCard weread={weread} /><WeiboCredentialsCard data={data} /></>;
}
