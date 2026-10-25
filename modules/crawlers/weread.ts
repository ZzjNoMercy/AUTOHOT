import { createSource } from "@aihot/backend/admin/sources";
import { audit } from "@aihot/backend/audit";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { sql } from "@aihot/backend/db";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { defineQueue } from "@aihot/backend/modules";
import {
  diagnoseWereadSession, noteWereadRateLimited, saveWereadSessionAfterRead, usableWereadSession,
  wereadAuthView, type WereadSessionSnapshot,
} from "./weread-auth.ts";
import { WereadError, wereadContent, wereadCover, type WereadCover } from "./weread-client.ts";
import { extractWereadBody, resolveWechatArticle, wereadReviewUrl, type ResolvedWechatArticle } from "./weread-articles.ts";

interface AccountRow {
  source_id: string;
  name: string;
  enabled: boolean;
  book_id: string;
  biz: string;
  source_article_url: string;
  status: "pending_validation" | "active";
  capability: "unknown" | "latest_only" | "list_available" | "blocked";
}

interface Validation {
  cover: WereadCover | null;
  session: WereadSessionSnapshot | null;
  errorCode: string | null;
  message: string | null;
}

interface AddInput {
  articleUrl: string;
  participationMode: "editorial" | "hot_signal" | "isolated";
  tier: "T1" | "T1_5" | "T2" | "EXCLUDE_MP";
  intervalMinutes: number;
}

export interface WereadPreview {
  resolved: { bookId: string; biz: string; numericId: string; articleUrl: string };
  duplicate: { sourceId: string; name: string } | null;
  name: string | null;
  nameSource: "article" | "weread" | null;
  status: "pending_validation" | "active";
  capability: "unknown" | "latest_only" | "list_available" | "blocked";
  errorCode: string | null;
  message: string | null;
  latest: { title: string; reviewId: string; publishedAt: string | null } | null;
}

export interface WereadCheckResult {
  sourceId: string;
  status: "missing" | "paused" | "ok" | "failed";
  found?: number;
  created?: number;
  contentStatus?: "ready" | "failed";
  contentErrorCode?: string | null;
  errorCode?: string;
  error?: string;
}

export interface WereadAddResult extends WereadPreview {
  created: boolean;
  sourceId?: string;
  authRequired?: boolean;
  check?: WereadCheckResult | null;
}

type WereadJob = { sourceId: string; reason: "schedule" | "manual"; articleId?: string };

function errorMessage(code: string | null): string {
  switch (code) {
    case "auth_required": return "需要先完成微信读书扫码授权";
    case "auth_invalid": return "微信读书会话已失效，请重新扫码";
    case "rate_limited": return "微信读书访问受限，已进入冷却，稍后再试";
    case "invalid_response": return "微信读书返回的数据无法确认";
    case "transient": return "微信读书暂时无法读取，请稍后重试";
    default: return "微信读书能力验证暂未通过，账号会保留为待验证";
  }
}

async function accountByBookId(bookId: string): Promise<AccountRow | null> {
  const [row] = await sql<AccountRow[]>`
    SELECT s.id AS source_id, s.name, s.enabled, w.book_id, w.biz, w.source_article_url, w.status, w.capability
    FROM crawler_weread_accounts w JOIN sources s ON s.id = w.source_id WHERE w.book_id = ${bookId}`;
  return row ?? null;
}

async function accountBySourceId(sourceId: string): Promise<AccountRow | null> {
  const [row] = await sql<AccountRow[]>`
    SELECT s.id AS source_id, s.name, s.enabled, w.book_id, w.biz, w.source_article_url, w.status, w.capability
    FROM crawler_weread_accounts w JOIN sources s ON s.id = w.source_id WHERE w.source_id = ${sourceId}`;
  return row ?? null;
}

async function readCover(bookId: string): Promise<{ cover: WereadCover; session: WereadSessionSnapshot }> {
  let session = await usableWereadSession();
  if (!session) throw new WereadError("auth_suspected", "微信读书未授权");
  if (session.blockedUntil && session.blockedUntil.getTime() > Date.now()) throw new WereadError("rate_limited", "微信读书处于访问冷却期");
  try {
    const cover = await wereadCover(session.jar, bookId);
    await saveWereadSessionAfterRead(session);
    return { cover, session };
  } catch (error) {
    if (!(error instanceof WereadError)) throw error;
    if (error.code === "rate_limited") await noteWereadRateLimited(String(error.providerCode ?? error.httpStatus ?? "rate_limited"));
    if (error.code !== "auth_suspected") throw error;
  }
  const auth = await diagnoseWereadSession();
  if (auth.status !== "valid") throw new WereadError("auth_suspected", "微信读书会话未通过验证");
  session = await usableWereadSession();
  if (!session) throw new WereadError("auth_suspected", "微信读书会话不可用");
  const cover = await wereadCover(session.jar, bookId);
  await saveWereadSessionAfterRead(session);
  return { cover, session };
}

async function validateResolved(resolved: ResolvedWechatArticle): Promise<Validation> {
  const current = await usableWereadSession();
  if (!current) {
    const auth = await wereadAuthView();
    const code = auth.status === "invalid" ? "auth_invalid" : auth.status === "unknown" ? "transient" : "auth_required";
    return { cover: null, session: null, errorCode: code, message: errorMessage(code) };
  }
  if (current.blockedUntil && current.blockedUntil.getTime() > Date.now()) {
    return { cover: null, session: null, errorCode: "rate_limited", message: errorMessage("rate_limited") };
  }
  try {
    const { cover, session } = await readCover(resolved.bookId);
    return { cover, session, errorCode: null, message: null };
  } catch (error) {
    const code = error instanceof WereadError ? error.code : "transient";
    const auth = await wereadAuthView();
    const normalized = auth.status === "invalid" ? "auth_invalid" : code;
    return { cover: null, session: null, errorCode: normalized, message: errorMessage(normalized) };
  }
}

function publicPreview(resolved: ResolvedWechatArticle, duplicate: AccountRow | null, validation: Validation | null): WereadPreview {
  return {
    resolved: { bookId: resolved.bookId, biz: resolved.biz, numericId: resolved.numericId, articleUrl: resolved.articleUrl },
    duplicate: duplicate ? { sourceId: duplicate.source_id, name: duplicate.name } : null,
    name: validation?.cover?.name ?? resolved.name ?? duplicate?.name ?? null,
    nameSource: validation?.cover ? "weread" : resolved.nameSource,
    status: validation?.cover ? "active" : duplicate?.status ?? "pending_validation",
    capability: validation?.cover ? "latest_only" : duplicate?.capability ?? "unknown",
    errorCode: validation?.errorCode ?? null,
    message: validation?.message ?? null,
    latest: validation?.cover ? {
      title: validation.cover.title,
      reviewId: validation.cover.reviewId,
      publishedAt: validation.cover.publishedAt?.toISOString() ?? null,
    } : null,
  };
}

export async function previewWereadAccount(articleUrl: string): Promise<WereadPreview> {
  const resolved = await resolveWechatArticle(articleUrl);
  const duplicate = await accountByBookId(resolved.bookId);
  if (duplicate) return publicPreview(resolved, duplicate, null);
  const validation = await validateResolved(resolved);
  return publicPreview(resolved, null, validation);
}

export async function addWereadAccount(input: AddInput, actor: string): Promise<WereadAddResult> {
  const resolved = await resolveWechatArticle(input.articleUrl);
  const existing = await accountByBookId(resolved.bookId);
  if (existing) return { created: false, ...publicPreview(resolved, existing, null) };

  const validation = await validateResolved(resolved);
  const name = validation.cover?.name ?? resolved.name ?? resolved.bookId;
  const sourceId = `mp-weread-${resolved.numericId}`;
  const register = async () => {
    await sql`INSERT INTO crawler_weread_accounts
              (source_id, book_id, biz, source_article_url, status, capability, validated_at, last_error_code)
              VALUES (${sourceId}, ${resolved.bookId}, ${resolved.biz}, ${resolved.articleUrl},
                ${validation.cover ? "active" : "pending_validation"}, ${validation.cover ? "latest_only" : "unknown"},
                ${validation.cover ? new Date() : null}, ${validation.errorCode})
              ON CONFLICT (source_id) DO NOTHING`;
  };
  const created = await createSource({
    id: sourceId,
    name,
    kind: "mp_account",
    config: { provider: "weread", bookId: resolved.bookId, biz: resolved.biz, sourceArticleUrl: resolved.articleUrl, nickname: name },
    tier: input.tier,
    participation_mode: input.participationMode,
    interval_minutes: input.intervalMinutes,
  }, actor);
  if (!created.created) {
    const [source] = await sql<{ config: { provider?: string; bookId?: string } }[]>`SELECT config FROM sources WHERE id = ${created.duplicate.id}`;
    if (source?.config.provider === "weread" && source.config.bookId === resolved.bookId) await register();
    const duplicate = await accountByBookId(resolved.bookId);
    return { created: false, ...publicPreview(resolved, duplicate, null) };
  }

  await register();
  await audit(actor, "crawler.weread_account", `source:${sourceId}`, null, null, {
    bookId: resolved.bookId, status: validation.cover ? "active" : "pending_validation", errorCode: validation.errorCode,
  });

  let check: WereadCheckResult | null = null;
  if (validation.cover && validation.session) {
    check = await observeWereadCover(sourceId, validation.cover, validation.session, "manual");
  } else {
    await sql`UPDATE sources SET last_error = ${validation.message}, next_fetch_at = now() + make_interval(mins => interval_minutes), updated_at = now() WHERE id = ${sourceId}`;
  }
  return {
    created: true,
    ...publicPreview(resolved, null, validation),
    sourceId,
    authRequired: validation.errorCode === "auth_required" || validation.errorCode === "auth_invalid",
    check,
  };
}

async function bodyFailure(articleId: string, code: string, message: string): Promise<void> {
  const detail = { contentStatus: "failed", contentError: message.slice(0, 300), contentErrorCode: code, contentLastAttemptAt: new Date().toISOString() };
  await sql`UPDATE articles SET body_status = CASE WHEN body_status = 'ok' THEN body_status ELSE 'none' END,
            raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{weread}', COALESCE(raw -> 'weread', '{}'::jsonb) || ${sql.json(detail as never)}::jsonb, true),
            updated_at = now()
            WHERE id = ${articleId}`;
}

async function fetchAndStoreBody(articleId: string, session: WereadSessionSnapshot): Promise<{ status: "ready" | "failed"; errorCode: string | null }> {
  const [article] = await sql<{ id: string; source_id: string; title: string; url: string; excerpt: string | null; published_at: Date | null; weread: { bookId?: string; reviewId?: string; coverUrl?: string | null } | null }[]>`
    SELECT id, source_id, title, url, excerpt, published_at, raw -> 'weread' AS weread FROM articles WHERE id = ${articleId}`;
  if (!article?.weread?.reviewId || !article.weread.bookId) return { status: "failed", errorCode: "invalid_response" };
  const { bookId, reviewId } = article.weread;
  const identityKey = `weread:${bookId}:${reviewId}`;
  try {
    const html = await wereadContent(session.jar, reviewId);
    const body = extractWereadBody(html, article.url);
    const canonical = body.canonicalUrl ?? article.url;
    const raw = {
      bookId,
      reviewId,
      coverUrl: article.weread.coverUrl ?? null,
      contentStatus: "ready",
      contentFetchedAt: new Date().toISOString(),
      contentError: null,
      contentErrorCode: null,
      plainTextFallback: body.plainTextFallback,
      publishedAtCheckedAt: new Date().toISOString(),
      publishedAtSource: body.publishedAt ? "content" : null,
    };
    const result = await sql.begin(async (tx) => {
      const saved = await upsertMaterial({
        sourceId: article.source_id,
        identityKey,
        url: canonical,
        title: article.title,
        language: "zh",
        publishedAt: article.published_at ?? body.publishedAt,
        excerpt: article.excerpt,
        bodyHtml: body.html,
        bodyText: body.text || null,
        bodyStatus: "ok",
        via: "fetch",
        raw: { weread: raw },
      }, tx);
      await tx`UPDATE articles SET url = ${canonical},
               raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{weread}', COALESCE(raw -> 'weread', '{}'::jsonb) || ${tx.json(raw as never)}::jsonb, true),
               body_status = 'ok', updated_at = now() WHERE id = ${articleId}`;
      return saved;
    });
    if (result.created || result.revised || result.processingNeeded) await queueProcessing(result.articleId);
    await saveWereadSessionAfterRead(session);
    return { status: "ready", errorCode: null };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code ?? "transient") : "transient";
    await bodyFailure(articleId, code, error instanceof Error ? error.message : "正文读取失败");
    if (error instanceof WereadError && error.code === "auth_suspected") await diagnoseWereadSession();
    if (error instanceof WereadError && error.code === "rate_limited") await noteWereadRateLimited(String(error.providerCode ?? "rate_limited"));
    return { status: "failed", errorCode: code };
  }
}

async function observeWereadCover(sourceId: string, cover: WereadCover, session: WereadSessionSnapshot, reason: "schedule" | "manual"): Promise<WereadCheckResult> {
  const account = await accountBySourceId(sourceId);
  if (!account) return { sourceId, status: "missing" as const };
  const [run] = await sql<{ id: number }[]>`INSERT INTO fetch_runs (source_id, detail) VALUES (${sourceId}, ${sql.json({ reason, capability: "latest_only" })}) RETURNING id`;
  let created = 0;
  try {
    const identityKey = `weread:${account.book_id}:${cover.reviewId}`;
    const url = wereadReviewUrl(cover.reviewId, account.book_id);
    const [known] = await sql<{ id: string; body_status: string; published_at: Date | null; published_at_checked_at: string | null }[]>`
      SELECT id, body_status, published_at, raw -> 'weread' ->> 'publishedAtCheckedAt' AS published_at_checked_at
      FROM articles WHERE identity_key = ${identityKey}`;
    const raw = {
      bookId: account.book_id,
      reviewId: cover.reviewId,
      coverUrl: cover.pic,
      contentStatus: "pending",
      contentFetchedAt: null,
      contentError: null,
    };
    const saved = await upsertMaterial({
      sourceId,
      identityKey,
      url,
      title: cover.title,
      language: "zh",
      publishedAt: cover.publishedAt,
      excerpt: cover.digest,
      bodyStatus: "pending",
      via: "fetch",
      raw: { weread: raw },
    });
    if (saved.created) created = 1;
    if (saved.created || saved.revised || saved.processingNeeded) await queueProcessing(saved.articleId);

    let body: { status: "ready" | "failed"; errorCode: string | null } = { status: "ready", errorCode: null };
    const shouldFetchBody = known?.body_status !== "ok" || (known.published_at === null && !known.published_at_checked_at);
    if (shouldFetchBody) body = await fetchAndStoreBody(saved.articleId, session);
    const contentResult = body.status === "failed" ? "failed" : shouldFetchBody ? "fetched" : "already_ready";
    if (cover.name && cover.name !== account.name) await sql`UPDATE sources SET name = ${cover.name}, updated_at = now() WHERE id = ${sourceId}`;
    if (cover.avatar) await sql`UPDATE sources SET icon_url = ${cover.avatar}, icon_checked_at = now() WHERE id = ${sourceId} AND icon_url IS NULL`;
    await sql`UPDATE crawler_weread_accounts SET status = 'active', capability = 'latest_only', validated_at = now(),
              last_seen_review_id = ${cover.reviewId}, last_error_code = NULL, updated_at = now() WHERE source_id = ${sourceId}`;
    await sql`UPDATE sources SET last_fetch_at = now(), last_ok_at = now(), fail_count = 0, last_error = NULL, health = 'ok',
              cursor = COALESCE(cursor, '{}'::jsonb) || ${sql.json({ lastCheckedAt: new Date().toISOString(), lastSeenReviewId: cover.reviewId } as never)}::jsonb,
              next_fetch_at = now() + make_interval(mins => interval_minutes), updated_at = now() WHERE id = ${sourceId}`;
    await sql`UPDATE fetch_runs SET status = 'ok', finished_at = now(), found_count = 1, new_count = ${created},
              detail = detail || ${sql.json({
                title: cover.title, reviewId: cover.reviewId, articleId: saved.articleId,
                articleResult: saved.created ? "created" : "already_stored", contentStatus: body.status, contentResult,
                contentErrorCode: body.errorCode,
              } as never)}::jsonb WHERE id = ${run!.id}`;
    return { sourceId, status: "ok" as const, found: 1, created, contentStatus: body.status, contentErrorCode: body.errorCode };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 300);
    await sql`UPDATE crawler_weread_accounts SET last_error_code = 'transient', updated_at = now() WHERE source_id = ${sourceId}`;
    await sql`UPDATE sources SET last_fetch_at = now(), last_error = ${message}, fail_count = fail_count + 1,
              health = CASE WHEN fail_count + 1 >= 3 THEN 'failing' ELSE 'degraded' END,
              next_fetch_at = now() + make_interval(mins => interval_minutes), updated_at = now() WHERE id = ${sourceId}`;
    await sql`UPDATE fetch_runs SET status = 'failed', finished_at = now(), new_count = ${created}, error = ${message} WHERE id = ${run!.id}`;
    return { sourceId, status: "failed" as const, errorCode: "transient", error: message };
  }
}

export async function checkWereadAccount(sourceId: string, reason: "schedule" | "manual"): Promise<WereadCheckResult> {
  const account = await accountBySourceId(sourceId);
  if (!account) return { sourceId, status: "missing" as const };
  if (!account.enabled && reason !== "manual") return { sourceId, status: "paused" as const };
  try {
    const { cover, session } = await readCover(account.book_id);
    return await observeWereadCover(sourceId, cover, session, reason);
  } catch (error) {
    const code = error instanceof WereadError ? error.code : "transient";
    const message = error instanceof WereadError ? error.message : errorMessage(code);
    if (error instanceof WereadError && error.code === "rate_limited") await noteWereadRateLimited(String(error.providerCode ?? "rate_limited"));
    await sql`UPDATE crawler_weread_accounts SET capability = CASE WHEN ${code} = 'rate_limited' THEN 'blocked' ELSE capability END,
              last_error_code = ${code}, updated_at = now() WHERE source_id = ${sourceId}`;
    await sql`UPDATE sources SET last_fetch_at = now(), last_error = ${message}, fail_count = fail_count + 1,
              health = CASE WHEN fail_count + 1 >= 3 THEN 'failing' ELSE 'degraded' END,
              next_fetch_at = now() + make_interval(mins => interval_minutes), updated_at = now() WHERE id = ${sourceId}`;
    await sql`INSERT INTO fetch_runs (source_id, status, finished_at, error, detail)
              VALUES (${sourceId}, 'failed', now(), ${message}, ${sql.json({ reason, errorCode: code } as never)})`;
    return { sourceId, status: "failed" as const, errorCode: code, error: message };
  }
}

export async function retryWereadBody(articleId: string) {
  const [article] = await sql<{ source_id: string }[]>`SELECT a.source_id FROM articles a JOIN crawler_weread_accounts w ON w.source_id = a.source_id WHERE a.id = ${articleId}`;
  if (!article) return { articleId, status: "missing" as const };
  try {
    const session = await usableWereadSession();
    if (!session) return { articleId, status: "failed" as const, errorCode: "auth_required" };
    if (session.blockedUntil && session.blockedUntil.getTime() > Date.now()) return { articleId, status: "failed" as const, errorCode: "rate_limited" };
    return { articleId, ...(await fetchAndStoreBody(articleId, session)) };
  } catch (error) {
    return { articleId, status: "failed" as const, errorCode: error instanceof WereadError ? error.code : "transient" };
  }
}

export const wereadQueue = defineQueue<WereadJob>({
  name: "crawlers.weread",
  options: { policy: "short", retryLimit: 0, expireInSeconds: 600 },
  worker: { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: 2 },
  run: async (items) => {
    for (const item of items) {
      if (item.articleId) await retryWereadBody(item.articleId);
      else await checkWereadAccount(item.sourceId, item.reason);
    }
  },
});

export async function enqueueWereadCheck(sourceId: string, reason: "schedule" | "manual") {
  const account = await accountBySourceId(sourceId);
  if (!account) return { queued: false, reason: "missing" as const };
  const session = await usableWereadSession();
  if (!session) return { queued: false, reason: "auth_required" as const };
  if (session.blockedUntil && session.blockedUntil.getTime() > Date.now()) return { queued: false, reason: "rate_limited" as const };
  const jobId = await enqueueOn(wereadQueue, { sourceId, reason }, { singletonKey: `weread:${sourceId}` });
  return { queued: jobId !== null, jobId, reason: jobId === null ? "already_queued" as const : null };
}

export async function enqueueWereadBodyRetry(articleId: string, actor: string) {
  const [article] = await sql<{ source_id: string }[]>`SELECT a.source_id FROM articles a JOIN crawler_weread_accounts w ON w.source_id = a.source_id WHERE a.id = ${articleId}`;
  if (!article) return { queued: false, reason: "missing" as const };
  const session = await usableWereadSession();
  if (!session) return { queued: false, reason: "auth_required" as const };
  if (session.blockedUntil && session.blockedUntil.getTime() > Date.now()) return { queued: false, reason: "rate_limited" as const };
  const jobId = await enqueueOn(wereadQueue, { sourceId: article.source_id, articleId, reason: "manual" }, { singletonKey: `weread-body:${articleId}` });
  await audit(actor, "crawler.weread_body_retry", `article:${articleId}`, null, null, { jobId });
  return { queued: jobId !== null, jobId, reason: jobId === null ? "already_queued" as const : null };
}

export async function enqueuePendingWereadAccounts(): Promise<number> {
  const rows = await sql<{ source_id: string }[]>`SELECT w.source_id FROM crawler_weread_accounts w JOIN sources s ON s.id = w.source_id WHERE w.status = 'pending_validation' AND s.enabled`;
  let enqueued = 0;
  for (const row of rows) {
    const result = await enqueueWereadCheck(row.source_id, "schedule");
    if (result.queued) enqueued += 1;
  }
  return enqueued;
}

export async function scheduleWereadReconcile(now = new Date()): Promise<{ enqueued: number }> {
  const session = await usableWereadSession();
  if (!session || session.blockedUntil && session.blockedUntil.getTime() > now.getTime()) return { enqueued: 0 };
  const rows = await sql<{ source_id: string }[]>`
    SELECT w.source_id FROM crawler_weread_accounts w JOIN sources s ON s.id = w.source_id
    WHERE s.enabled AND (s.next_fetch_at IS NULL OR s.next_fetch_at <= ${now}) ORDER BY s.next_fetch_at NULLS FIRST`;
  let enqueued = 0;
  for (const row of rows) {
    const result = await enqueueWereadCheck(row.source_id, "schedule");
    if (result.queued) enqueued += 1;
  }
  return { enqueued };
}
