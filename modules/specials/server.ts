// The specials backend: public reads, the editor's API, the two scheduled passes and the digest queue.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { sessionPrincipal } from "@aihot/backend/admin/auth";
import { audit } from "@aihot/backend/audit";
import { siteUrl } from "@aihot/backend/publication/links";
import { sql } from "@aihot/backend/db";
import { defineQueue, defineServerModule } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { attachManual, detach, loadSpecial, syncMembership, syncPublished } from "./membership.ts";
import { ignoreCandidate } from "./candidates.ts";
import { composeSpecialDigest, refreshSpecialDigests } from "./digest.ts";
import { createSpecial, getAdminSpecial, listAdminSpecials, updateSpecial } from "./admin.ts";
import { loadSpecialBySlug, loadSpecials } from "./public.ts";

interface Admin { name: string; csrf: string }
type Handler = (req: FastifyRequest, reply: FastifyReply, admin: Admin) => Promise<unknown>;

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
      if (status >= 500) req.log.error({ err: error }, "specials admin api error");
      return reply.code(status).send({ detail: String(error instanceof Error ? error.message : error).slice(0, 300) });
    }
  };
}

const digestQueue = defineQueue<{ specialId: number }>({
  name: "specials.digest",
  options: { policy: "short", retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 900 },
  worker: { localConcurrency: 1, pollingIntervalSeconds: 5 },
  run: async (items) => {
    for (const item of items) await composeSpecialDigest(item.specialId);
  },
});

const CreateBody = z.object({
  title: z.string().trim().min(2).max(160),
  slug: z.string().trim().max(80).optional(),
  aliases: z.array(z.string().trim().max(120)).max(40).default([]),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  intro: z.string().max(2000).nullable().optional(),
  coverUrl: z.string().url().max(1000).nullable().optional(),
}).strict();

const UpdateBody = CreateBody.partial().extend({
  status: z.enum(["draft", "published", "archived"]).optional(),
}).strict();

const AttachBody = z.object({ articleId: z.string().min(1).max(120) }).strict();
const IgnoreBody = z.object({ key: z.string().min(1).max(200) }).strict();

const idOf = (req: FastifyRequest): number => {
  const id = Number((req.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("专题不存在"), { statusCode: 404 });
  return id;
};

async function enqueueDigest(specialId: number) {
  await enqueueOn(digestQueue, { specialId }, { singletonKey: `special:${specialId}` });
}

function routes(app: FastifyInstance) {
  app.get("/api/specials", async (_req, reply) => {
    reply.header("Cache-Control", "public, s-maxage=60");
    return loadSpecials();
  });

  app.get("/api/specials/:slug", async (req, reply) => {
    const special = await loadSpecialBySlug((req.params as { slug: string }).slug);
    if (!special) return reply.code(404).send({ detail: "专题不存在" });
    reply.header("Cache-Control", "public, s-maxage=60");
    return { special };
  });

  app.post("/api/admin/specials/candidates/ignore", guard(async (req, _reply, admin) => {
    const body = IgnoreBody.parse(req.body ?? {});
    await ignoreCandidate(body.key);
    await audit(admin.name, "special.candidate.ignore", `special-candidate:${body.key}`, null, null, null);
    return { ok: true };
  }));

  app.get("/api/admin/specials", guard(async () => listAdminSpecials()));

  app.get("/api/admin/specials/:id", guard(async (req, reply) => {
    const special = await getAdminSpecial(idOf(req));
    if (!special) return reply.code(404).send({ detail: "专题不存在" });
    return { special };
  }));

  app.post("/api/admin/specials", guard(async (req, _reply, admin) => {
    const body = CreateBody.parse(req.body ?? {});
    const id = await createSpecial(body);
    const special = await loadSpecial(id);
    if (special) await syncMembership(special);
    await audit(admin.name, "special.create", `special:${id}`, null, null, { title: body.title, slug: body.slug ?? null });
    return { id };
  }));

  app.patch("/api/admin/specials/:id", guard(async (req, reply, admin) => {
    const id = idOf(req);
    const body = UpdateBody.parse(req.body ?? {});
    const before = await loadSpecial(id);
    if (!before) return reply.code(404).send({ detail: "专题不存在" });
    const after = await updateSpecial(id, body);
    if (!after) return reply.code(404).send({ detail: "专题不存在" });
    await audit(admin.name, "special.update", `special:${id}`, null, { title: before.title, status: before.status }, { patch: body });
    if (body.status === "published" || after.status === "published") await enqueueDigest(id);
    return { special: await getAdminSpecial(id) };
  }));

  app.post("/api/admin/specials/:id/sync", guard(async (req) => {
    const id = idOf(req);
    const special = await loadSpecial(id);
    if (!special) return { changed: false, reports: 0 };
    const result = await syncMembership(special);
    if (result.changed) await enqueueDigest(id);
    return result;
  }));

  app.post("/api/admin/specials/:id/attach", guard(async (req, reply, admin) => {
    const id = idOf(req);
    const body = AttachBody.parse(req.body ?? {});
    if (!(await attachManual(id, body.articleId))) return reply.code(404).send({ detail: "报道不存在" });
    await audit(admin.name, "special.attach", `special:${id}`, null, null, { articleId: body.articleId });
    await enqueueDigest(id);
    return { ok: true };
  }));

  app.post("/api/admin/specials/:id/detach", guard(async (req, _reply, admin) => {
    const id = idOf(req);
    const body = AttachBody.parse(req.body ?? {});
    await detach(id, body.articleId);
    await audit(admin.name, "special.detach", `special:${id}`, null, null, { articleId: body.articleId });
    await enqueueDigest(id);
    return { ok: true };
  }));

  app.post("/api/admin/specials/:id/digest", guard(async (req) => {
    const id = idOf(req);
    const special = await loadSpecial(id);
    if (!special) return { enqueued: false };
    await enqueueDigest(id);
    return { enqueued: true };
  }));
}

export const specialsServer = defineServerModule({
  name: "specials",
  http: routes,
  queues: [digestQueue],
  schedules: [
    { name: "specials.match", cron: "*/10 * * * *", run: () => syncPublished() },
    { name: "specials.digest-sweep", cron: "*/30 * * * *", run: () => refreshSpecialDigests() },
  ],
  llms: () => ({
    pages: [`- [专题](${siteUrl("/specials")})：大会与系列专题，按主题聚合多个独立事件。`],
  }),
  sitemap: {
    pages: [{ loc: "/specials", changefreq: "daily", priority: 0.7 }],
    entries: async () => (await sql<{ slug: string; updated_at: Date }[]>`
      SELECT slug, updated_at FROM specials WHERE status = 'published' ORDER BY updated_at DESC`)
      .map((row) => ({ loc: `/specials/${row.slug}`, lastmod: row.updated_at, changefreq: "daily", priority: 0.6 })),
  },
  admin: {
    counts: {
      specials: async () => Number((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM specials WHERE status = 'published'`)[0]?.n ?? 0),
    },
  },
});
