import { randomUUID } from "node:crypto";
import { renderSVG } from "uqr";
import { audit } from "@aihot/backend/audit";
import { sql } from "@aihot/backend/db";
import {
  WereadError, loginCode, loginConfirmUrl, loginSucceeded, loginUid, pollLogin,
  renewWereadSession, validateWereadSession, type WereadCookieJar,
} from "./weread-client.ts";
import { maskValue } from "./credentials.ts";

const CREDENTIAL_COLLECTOR = "weread";
const LOGIN_WINDOW_MS = 300_000;
const RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;

export type WereadAuthStatus = "missing" | "pending" | "valid" | "invalid" | "unknown";

interface AuthRow {
  auth_status: WereadAuthStatus;
  validated_at: Date | null;
  active_login_id: string | null;
  blocked_until: Date | null;
  last_error_code: string | null;
}

interface LoginRow {
  id: string;
  uid: string;
  cookies: WereadCookieJar;
  status: "pending" | "succeeded" | "expired" | "failed" | "superseded";
  expires_at: Date;
  last_error_code: string | null;
}

export interface WereadAuthView {
  status: WereadAuthStatus;
  validatedAt: string | null;
  lastErrorCode: string | null;
  blockedUntil: string | null;
  loginPending: boolean;
  maskedVid: string | null;
}

export interface WereadSessionSnapshot {
  jar: WereadCookieJar;
  raw: string;
  status: WereadAuthStatus;
  blockedUntil: Date | null;
}

interface StoredSession {
  version: 1;
  cookies: WereadCookieJar;
  savedAt: string;
}

async function ensureAuthRow(): Promise<void> {
  await sql`INSERT INTO crawler_weread_auth (id) VALUES (true) ON CONFLICT (id) DO NOTHING`;
}

async function authRow(): Promise<AuthRow> {
  await ensureAuthRow();
  const [row] = await sql<AuthRow[]>`SELECT auth_status, validated_at, active_login_id, blocked_until, last_error_code FROM crawler_weread_auth WHERE id = true`;
  return row!;
}

function validJar(value: unknown): WereadCookieJar | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([key, item]) => key.length <= 200 && typeof item === "string" && item.length <= 20_000)) return null;
  return Object.fromEntries(entries) as WereadCookieJar;
}

async function storedSession(): Promise<{ raw: string; jar: WereadCookieJar } | null> {
  const [row] = await sql<{ fields: { session?: unknown } }[]>`
    SELECT c.fields FROM crawler_weread_auth a
    JOIN crawler_credentials c ON c.collector = split_part(a.credential_ref, ':', 2)
    WHERE a.id = true`;
  if (typeof row?.fields.session !== "string") return null;
  try {
    const parsed = JSON.parse(row.fields.session) as Partial<StoredSession>;
    const jar = validJar(parsed.cookies);
    if (parsed.version !== 1 || !jar || !Object.keys(jar).length) return null;
    return { raw: row.fields.session, jar };
  } catch {
    return null;
  }
}

function serializedSession(jar: WereadCookieJar): string {
  const value: StoredSession = { version: 1, cookies: jar, savedAt: new Date().toISOString() };
  return JSON.stringify(value);
}

export async function wereadAuthView(): Promise<WereadAuthView> {
  const [auth, stored] = await Promise.all([authRow(), storedSession()]);
  let loginPending = false;
  if (auth.active_login_id) {
    const [login] = await sql<{ status: string; expired: boolean }[]>`
      SELECT status, expires_at <= now() AS expired FROM crawler_weread_logins WHERE id = ${auth.active_login_id}`;
    loginPending = login?.status === "pending" && !login.expired;
  }
  const status: WereadAuthStatus = !stored
    ? loginPending ? "pending" : "missing"
    : loginPending && auth.auth_status === "missing" ? "pending" : auth.auth_status;
  return {
    status,
    validatedAt: auth.validated_at?.toISOString() ?? null,
    lastErrorCode: auth.last_error_code,
    blockedUntil: auth.blocked_until?.toISOString() ?? null,
    loginPending,
    maskedVid: stored?.jar.wr_vid ? maskValue(stored.jar.wr_vid) : null,
  };
}

export async function currentWereadSession(): Promise<WereadSessionSnapshot | null> {
  const [auth, stored] = await Promise.all([authRow(), storedSession()]);
  if (!stored) return null;
  return { jar: stored.jar, raw: stored.raw, status: auth.auth_status, blockedUntil: auth.blocked_until };
}

export async function usableWereadSession(): Promise<WereadSessionSnapshot | null> {
  const session = await currentWereadSession();
  return session?.status === "valid" ? session : null;
}

async function setSessionState(status: WereadAuthStatus, errorCode: string | null, expectedRaw: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [credentialRow] = await tx<{ fields: { session?: unknown } }[]>`
      SELECT fields FROM crawler_credentials WHERE collector = ${CREDENTIAL_COLLECTOR} FOR UPDATE`;
    if (credentialRow?.fields.session !== expectedRaw) return false;
    await tx`INSERT INTO crawler_weread_auth (id, auth_status, last_error_code, updated_at)
             VALUES (true, ${status}, ${errorCode}, now())
             ON CONFLICT (id) DO UPDATE SET auth_status = EXCLUDED.auth_status,
               last_error_code = EXCLUDED.last_error_code, updated_at = now()`;
    return true;
  });
}

async function saveVerifiedSession(jar: WereadCookieJar, actor: string | null, options: { flowId?: string; expectedRaw?: string } = {}): Promise<boolean> {
  const raw = serializedSession(jar);
  const saved = await sql.begin(async (tx) => {
    const [auth] = await tx<AuthRow[]>`SELECT * FROM crawler_weread_auth WHERE id = true FOR UPDATE`;
    if (options.flowId && auth?.active_login_id !== options.flowId) {
      await tx`UPDATE crawler_weread_logins SET status = 'superseded', updated_at = now() WHERE id = ${options.flowId}`;
      return false;
    }
    if (options.expectedRaw !== undefined) {
      const [current] = await tx<{ fields: { session?: unknown } }[]>`
        SELECT fields FROM crawler_credentials WHERE collector = ${CREDENTIAL_COLLECTOR} FOR UPDATE`;
      if (current?.fields.session !== options.expectedRaw) return false;
    }
    const fields = { session: raw };
    await tx`INSERT INTO crawler_credentials (collector, fields, updated_at, updated_by)
             VALUES (${CREDENTIAL_COLLECTOR}, ${tx.json(fields as never)}, now(), ${actor})
             ON CONFLICT (collector) DO UPDATE SET fields = EXCLUDED.fields, updated_at = now(),
               updated_by = COALESCE(EXCLUDED.updated_by, crawler_credentials.updated_by)`;
    await tx`INSERT INTO crawler_weread_auth (id, auth_status, validated_at, active_login_id, blocked_until, last_error_code, updated_at)
             VALUES (true, 'valid', now(), NULL, NULL, NULL, now())
             ON CONFLICT (id) DO UPDATE SET auth_status = 'valid', validated_at = now(), active_login_id = NULL,
               blocked_until = NULL, last_error_code = NULL, updated_at = now()`;
    if (options.flowId) {
      await tx`UPDATE crawler_weread_logins SET status = 'succeeded', cookies = ${tx.json(jar as never)}, updated_at = now()
               WHERE id = ${options.flowId} AND status = 'pending'`;
    }
    if (actor) await audit(actor, "crawler.weread_auth", "crawler:weread", null, null, { status: "valid" }, { db: tx });
    return true;
  });
  return saved;
}

export async function saveWereadSessionAfterRead(session: WereadSessionSnapshot): Promise<boolean> {
  const saved = await saveVerifiedSession(session.jar, null, { expectedRaw: session.raw });
  if (saved) {
    const current = await storedSession();
    if (current) session.raw = current.raw;
  }
  return saved;
}

export async function diagnoseWereadSession(actor: string | null = null): Promise<WereadAuthView> {
  const session = await currentWereadSession();
  if (!session) {
    await ensureAuthRow();
    await sql`UPDATE crawler_weread_auth SET auth_status = 'missing', last_error_code = NULL, updated_at = now() WHERE id = true`;
    return wereadAuthView();
  }
  const candidate = { ...session.jar };
  try {
    await validateWereadSession(candidate);
    await saveVerifiedSession(candidate, actor, { expectedRaw: session.raw });
    return wereadAuthView();
  } catch (error) {
    if (!(error instanceof WereadError) || error.code !== "auth_suspected") {
      await setSessionState("unknown", error instanceof WereadError ? error.code : "transient", session.raw);
      return wereadAuthView();
    }
  }

  const renewed = { ...session.jar };
  try {
    await renewWereadSession(renewed);
    await validateWereadSession(renewed);
    await saveVerifiedSession(renewed, actor, { expectedRaw: session.raw });
  } catch (error) {
    const invalid = error instanceof WereadError && error.code === "auth_suspected";
    await setSessionState(invalid ? "invalid" : "unknown", invalid ? "auth_invalid" : error instanceof WereadError ? error.code : "transient", session.raw);
  }
  return wereadAuthView();
}

export async function noteWereadRateLimited(code: string): Promise<void> {
  await ensureAuthRow();
  await sql`UPDATE crawler_weread_auth SET blocked_until = ${new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS)},
            last_error_code = ${code}, updated_at = now() WHERE id = true`;
}

export async function startWereadLogin(actor: string): Promise<{ flowId: string; qrSvg: string; expiresAt: string }> {
  const jar: WereadCookieJar = {};
  const uid = await loginUid(jar);
  const flowId = randomUUID();
  const expiresAt = new Date(Date.now() + LOGIN_WINDOW_MS);
  await ensureAuthRow();
  await sql.begin(async (tx) => {
    await tx`SELECT id FROM crawler_weread_auth WHERE id = true FOR UPDATE`;
    const [previous] = await tx<{ active_login_id: string | null }[]>`SELECT active_login_id FROM crawler_weread_auth WHERE id = true`;
    if (previous?.active_login_id) {
      await tx`UPDATE crawler_weread_logins SET status = 'superseded', updated_at = now()
               WHERE id = ${previous.active_login_id} AND status = 'pending'`;
    }
    await tx`INSERT INTO crawler_weread_logins (id, uid, cookies, expires_at)
             VALUES (${flowId}, ${uid}, ${tx.json(jar as never)}, ${expiresAt})`;
    await tx`UPDATE crawler_weread_auth SET active_login_id = ${flowId}, updated_at = now() WHERE id = true`;
    await audit(actor, "crawler.weread_login_start", "crawler:weread", null, null, { flowId }, { db: tx });
  });
  return { flowId, qrSvg: renderSVG(loginConfirmUrl(uid), { border: 2, ecc: "M" }), expiresAt: expiresAt.toISOString() };
}

async function clearActiveLogin(flowId: string, status: LoginRow["status"], errorCode: string | null): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`UPDATE crawler_weread_logins SET status = ${status}, last_error_code = ${errorCode}, updated_at = now() WHERE id = ${flowId}`;
    await tx`UPDATE crawler_weread_auth SET active_login_id = NULL, updated_at = now()
             WHERE id = true AND active_login_id = ${flowId}`;
  });
}

export async function pollWereadLogin(flowId: string, actor: string): Promise<{ status: "pending" | "validating" | "succeeded" | "expired" | "failed" | "superseded"; errorCode: string | null; auth: WereadAuthView }> {
  const [login] = await sql<LoginRow[]>`SELECT id, uid, cookies, status, expires_at, last_error_code FROM crawler_weread_logins WHERE id = ${flowId}`;
  if (!login) return { status: "failed", errorCode: "login_not_found", auth: await wereadAuthView() };
  const auth = await wereadAuthView();
  if (login.status !== "pending") return { status: login.status, errorCode: login.last_error_code, auth };
  if (login.expires_at.getTime() <= Date.now()) {
    await clearActiveLogin(flowId, "expired", "login_timeout");
    return { status: "expired", errorCode: "login_timeout", auth: await wereadAuthView() };
  }

  const jar = validJar(login.cookies) ?? {};
  let payload: Record<string, unknown>;
  try {
    payload = await pollLogin(jar, login.uid);
  } catch (error) {
    const code = error instanceof WereadError ? error.code : "transient";
    await sql`UPDATE crawler_weread_logins SET cookies = ${sql.json(jar as never)}, last_error_code = ${code}, updated_at = now() WHERE id = ${flowId}`;
    return { status: "pending", errorCode: code, auth: await wereadAuthView() };
  }
  await sql`UPDATE crawler_weread_logins SET cookies = ${sql.json(jar as never)}, updated_at = now() WHERE id = ${flowId}`;

  if (!loginSucceeded(payload)) {
    const code = loginCode(payload);
    if (!code || code === "LOGIN_TIMEOUT") return { status: "pending", errorCode: code, auth: await wereadAuthView() };
    const terminal = code === "NEED_OTP" ? "need_otp" : "login_rejected";
    await clearActiveLogin(flowId, "failed", terminal);
    return { status: "failed", errorCode: terminal, auth: await wereadAuthView() };
  }

  try {
    await validateWereadSession(jar);
  } catch (error) {
    const code = error instanceof WereadError ? error.code : "transient";
    if (code === "auth_suspected") {
      await clearActiveLogin(flowId, "failed", "auth_invalid");
      return { status: "failed", errorCode: "auth_invalid", auth: await wereadAuthView() };
    }
    await sql`UPDATE crawler_weread_logins SET cookies = ${sql.json(jar as never)}, last_error_code = ${code}, updated_at = now() WHERE id = ${flowId}`;
    return { status: "validating", errorCode: code, auth: await wereadAuthView() };
  }

  const saved = await saveVerifiedSession(jar, actor, { flowId });
  if (!saved) return { status: "superseded", errorCode: null, auth: await wereadAuthView() };
  return { status: "succeeded", errorCode: null, auth: await wereadAuthView() };
}
