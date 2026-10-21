// 采集器的后端：后台「采集」页用的接口（公众号/微博名单、财联社话题、凭据读写、状态）。
// 守卫自己写：引擎的 adminHandler 在 apps/api 里，模块拿不到（会话与 CSRF 的原语在 @aihot/backend/admin/auth）。
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { sessionPrincipal } from "@aihot/backend/admin/auth";
import { createSource } from "@aihot/backend/admin/sources";
import { sql } from "@aihot/backend/db";
import { enqueue, QUEUES } from "@aihot/backend/jobs/queue";
import { defineServerModule } from "@aihot/backend/modules";
import { proxiedImage } from "@aihot/backend/media/imgproxy";
import { dajialaConfigured } from "@aihot/backend/providers/dajiala";
import { credentialState, maskValue, saveCredentials } from "./credentials.ts";
import { dispatchCrawlers, fetchCrawlerSource } from "./fetch.ts";
import {
  CLS_TOPICS, COLLECTORS, collectorOf, CRAWLER_PAGE_SIZE, clsSource, DEFAULT_WEIBO_ACCOUNTS, mpSourceRows,
  registerCrawlerSource, saveClsTopics, setCrawlerIcon, weiboSourceRows, type Collector, type Topic,
} from "./registry.ts";

interface Admin { name: string; csrf: string }
type Handler = (req: FastifyRequest, reply: FastifyReply, admin: Admin) => Promise<unknown>;

/** /api/admin/crawlers* 的守卫：要有会话，写操作要有 CSRF；出错按后台惯例返回 { detail }。 */
function guard(fn: Handler) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const admin = await sessionPrincipal(req.headers.cookie);
    if (!admin) return reply.code(401).send({ detail: "请先登录后台" });
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-csrf-token"] !== admin.csrf) {
      return reply.code(403).send({ detail: "CSRF 校验失败，请刷新页面重试" });
    }
    try {
      return await fn(req, reply, admin);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ detail: error.issues.map((i) => `${i.path.join(".") || "请求"}: ${i.message}`).join("; ").slice(0, 300) });
      }
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      if (status >= 500) req.log.error({ err: error }, "crawlers admin api error");
      return reply.code(status).send({ detail: String(error instanceof Error ? error.message : error).slice(0, 300) });
    }
  };
}

const CredentialsBody = z.object({
  collector: z.enum(COLLECTORS),
  fields: z.record(z.string().max(40), z.string().max(20_000)),
}).strict();

/** 微博账号：一个 uid 建一个源（这样每个账号在热度里算一个独立参与者）。 */
const WeiboAccountsBody = z.object({
  accounts: z.array(z.object({ account: z.string().min(1).max(40), name: z.string().min(1).max(120) })).max(200).default([]),
  participationMode: z.enum(["editorial", "hot_signal", "isolated"]).default("editorial"),
  tier: z.enum(["T1", "T1_5", "T2", "EXCLUDE_MP"]).default("T2"),
  intervalMinutes: z.number().int().min(1).max(1440).default(60),
}).strict();

/** 公众号清单：一个 ghid 建一个 mp_account 源，由引擎的 mp 任务检查（有 Dajiala key 才跑）。 */
const MpAccountsBody = z.object({
  accounts: z.array(z.object({ ghid: z.string().min(3).max(80), name: z.string().max(120).default("") })).min(1).max(200),
  participationMode: z.enum(["editorial", "hot_signal", "isolated"]).default("editorial"),
  tier: z.enum(["T1", "T1_5", "T2", "EXCLUDE_MP"]).default("T2"),
  intervalMinutes: z.number().int().min(1).max(1440).default(60),
}).strict();

/** 财联社的话题订阅：至少一个，ID 去重。 */
const TopicsBody = z.object({
  topics: z.array(z.object({ id: z.string().regex(/^\d{1,10}$/), name: z.string().min(1).max(40) })).min(1).max(30),
}).strict();

/** 微博必须两个字段都有；缺了就在保存时拦下来，别等到抓取失败。 */
function assertCredentials(collector: Collector, fields: Record<string, string>): void {
  if (collector === "weibo") {
    for (const key of ["cookie", "xsrfToken"]) {
      if (!fields[key]?.trim()) throw Object.assign(new Error(`微博的 ${key} 不能为空`), { statusCode: 400 });
    }
  }
  if (!Object.keys(fields).length) throw Object.assign(new Error("没有要保存的字段"), { statusCode: 400 });
}

/** How the settings page shows a collector's credential: where it comes from, and only its masked tail. */
async function credentialView(collector: Collector) {
  const state = await credentialState(collector);
  return {
    saved: state !== null,
    from: state?.from ?? null,
    updatedAt: state?.updatedAt?.toISOString() ?? null,
    updatedBy: state?.updatedBy ?? null,
    masked: state ? Object.fromEntries(Object.entries(state.fields).map(([k, v]) => [k, maskValue(v)])) : null,
  };
}

/** 公众号清单的源 ID：ghid 里只留下小写字母、数字和连字符。 */
function mpSourceId(ghid: string): string {
  const slug = ghid.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  return `mp-${slug}`;
}

async function overview(page: number) {
  const [weibo, mp, cls, dajiala, weiboCredential] = await Promise.all([
    weiboSourceRows(page), mpSourceRows(), clsSource(), dajialaConfigured(), credentialView("weibo"),
  ]);
  return {
    weibo: {
      page,
      total: weibo.total,
      pageSize: CRAWLER_PAGE_SIZE,
      // 头像走签名图片代理：sinaimg 会拒绝来自别的站点的浏览器请求，直接用它的地址在后台是空图。
      rows: weibo.rows.map((s) => ({
        ...s,
        icon: s.icon ? proxiedImage(s.icon, "avatar") : null,
        lastOkAt: s.last_ok_at?.toISOString() ?? null,
        last_ok_at: undefined,
      })),
    },
    mp: {
      total: mp.length,
      dajiala,
      rows: mp.map((s) => ({
        ...s,
        icon: s.icon ? proxiedImage(s.icon, "avatar") : null,
        lastOkAt: s.last_ok_at?.toISOString() ?? null,
        last_ok_at: undefined,
      })),
    },
    cls: cls
      ? {
          ...cls,
          topics: cls.topics ?? null,
          lastOkAt: cls.last_ok_at?.toISOString() ?? null,
          last_ok_at: undefined,
        }
      : null,
    credential: weiboCredential,
    defaults: { weiboAccounts: DEFAULT_WEIBO_ACCOUNTS, clsTopics: CLS_TOPICS },
  };
}

export const crawlersServer = defineServerModule({
  name: "crawlers",
  // 每分钟把到点的采集器源派出去（和引擎的 cron.sources.schedule 同一个节奏）。
  schedules: [{ name: "crawlers.dispatch", cron: "* * * * *", run: () => dispatchCrawlers() }],
  // 采集器信源由模块自己采集：微博是引擎的 weibo 类型（页面上标出平台），财联社仍是 external。
  // 引擎的采集循环本来就跳过 external，weibo 也在 collect.ts 里跳过。
  sourceKinds: {
    external: {
      fetchNow: async (source) => {
        if (!(await collectorOf(source.id))) return { skipped: "不是采集器信源" };
        return { ...(await fetchCrawlerSource(source.id)) };
      },
    },
    weibo: {
      fetchNow: async (source) => {
        if (!(await collectorOf(source.id))) return { skipped: "不是采集器信源" };
        return { ...(await fetchCrawlerSource(source.id)) };
      },
    },
  },
  admin: {
    // 设置页的「采集凭据」：微博登录态和 Dajiala key 放在一起；保存仍走本模块自己的接口。
    settings: async () => ({ weibo: await credentialView("weibo") }),
  },
  http(app: FastifyInstance) {
    // 一页一页读：账号多了以后页面不能一次拉全部行。
    app.get("/api/admin/crawlers", guard(async (req, reply) => {
      const page = Math.max(1, Number((req.query as { page?: string } | undefined)?.page) || 1);
      return reply.send(await overview(page));
    }));

    // 「全部抓一次」：微博/财联社忽略下次抓取时间串行跑一遍；公众号排进 mp 队列（排查用）。
    app.post("/api/admin/crawlers/run", guard(async (_req, reply) => {
      const crawlers = await dispatchCrawlers(true);
      const accounts = await sql<{ id: string }[]>`SELECT id FROM sources WHERE kind = 'mp_account' AND enabled`;
      let enqueued = 0;
      for (const account of accounts) {
        if (await enqueue(QUEUES.mpCheck, { sourceId: account.id, reason: "manual" }, { singletonKey: `mp:${account.id}` })) enqueued += 1;
      }
      return reply.send({ ok: true, ...crawlers, mp: enqueued });
    }));

    app.post("/api/admin/crawlers/credentials", guard(async (req, reply, admin) => {
      const body = CredentialsBody.parse(req.body ?? {});
      const fields = Object.fromEntries(Object.entries(body.fields).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== "")) as Record<string, string>;
      assertCredentials(body.collector, fields);
      await saveCredentials(body.collector, fields, admin.name);
      // 写操作只回结果：页面保存后会重新取当前页，不必把整页数据塞进这个响应。
      return reply.send({ ok: true });
    }));

    // 账号头像：手动填一个 URL（空字符串 = 取消手动，回到采集时自动取到的头像）。
    app.post("/api/admin/crawlers/icon", guard(async (req, reply) => {
      const body = z.object({ sourceId: z.string().min(1).max(80), iconUrl: z.string().max(2000) }).strict().parse(req.body ?? {});
      if (!(await collectorOf(body.sourceId))) throw Object.assign(new Error("不是采集器信源"), { statusCode: 404 });
      const url = body.iconUrl.trim();
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw Object.assign(new Error("头像要是一个 http(s) 地址"), { statusCode: 400 });
      await setCrawlerIcon(body.sourceId, url || null);
      return reply.send({ ok: true });
    }));

    // 建源：weibo 每个账号一个源（这样每个账号在热度里算一个独立参与者）。
    app.post("/api/admin/crawlers/sources", guard(async (req, reply, admin) => {
      const body = WeiboAccountsBody.parse(req.body ?? {});
      const created: string[] = [];
      const wasNew: boolean[] = [];
      for (const account of body.accounts) {
        const uid = account.account.trim();
        if (!/^\d{5,20}$/.test(uid)) throw Object.assign(new Error(`微博 uid 不合法：${uid}`), { statusCode: 400 });
        const res = await registerCrawlerSource({
          sourceId: `ext-weibo-${uid}`, name: account.name.trim(), collector: "weibo",
          account: uid, label: account.name.trim(),
          tier: body.tier, participationMode: body.participationMode, intervalMinutes: body.intervalMinutes,
        }, admin.name);
        created.push(`ext-weibo-${uid}`);
        wasNew.push(res.created);
      }
      return reply.send({ ok: true, created, wasNew });
    }));

    // 公众号清单：一行一个 ghid，建引擎的 mp_account 源；已存在的按 ghid 跳过，不覆盖已有配置。
    app.post("/api/admin/crawlers/mp-accounts", guard(async (req, reply, admin) => {
      const body = MpAccountsBody.parse(req.body ?? {});
      const created: string[] = [];
      const duplicates: Array<{ ghid: string; sourceId: string; name: string }> = [];
      const failed: Array<{ ghid: string; error: string }> = [];
      for (const item of body.accounts) {
        const ghid = item.ghid.trim();
        const name = item.name.trim() || ghid;
        if (!/^[A-Za-z0-9_-]{3,80}$/.test(ghid)) {
          failed.push({ ghid, error: "ghid 只能包含字母、数字、下划线和连字符" });
          continue;
        }
        try {
          const res = await createSource({
            id: mpSourceId(ghid), name, kind: "mp_account", config: { ghid, nickname: name },
            tier: body.tier, participation_mode: body.participationMode, interval_minutes: body.intervalMinutes,
          }, admin.name);
          if (res.created) created.push(res.source.id);
          else duplicates.push({ ghid, sourceId: res.duplicate.id, name: res.duplicate.name });
        } catch (error) {
          failed.push({ ghid, error: String(error instanceof Error ? error.message : error).slice(0, 200) });
        }
      }
      return reply.send({ ok: true, created, duplicates, failed });
    }));

    // 财联社话题订阅：保存选中的话题；没有 ext-cls 源时顺手建一个。
    app.post("/api/admin/crawlers/topics", guard(async (req, reply, admin) => {
      const body = TopicsBody.parse(req.body ?? {});
      const seen = new Set<string>();
      const topics: Topic[] = body.topics.map((item) => {
        const id = item.id.trim();
        const name = item.name.trim();
        if (seen.has(id)) throw Object.assign(new Error(`话题 ${id} 重复了`), { statusCode: 400 });
        seen.add(id);
        return { id, name };
      });
      await saveClsTopics(topics, admin.name);
      return reply.send({ ok: true });
    }));
  },
});
