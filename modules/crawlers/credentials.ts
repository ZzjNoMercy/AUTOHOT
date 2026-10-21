// 采集器的凭据：优先用后台「设置 → 采集凭据」保存的值，没有再退回环境变量。
// 会过期的登录态（微博 cookie/XSRF）放在这里，改完立刻生效，不用重启容器。
import { sql } from "@aihot/backend/db";
import { audit } from "@aihot/backend/audit";
import { maskSecret } from "@aihot/backend/lib/secret";

/** 每种采集器可以从环境变量读的字段（没在后台填过时的退路）。 */
const ENV_FALLBACK: Record<string, ReadonlyArray<readonly [string, string]>> = {
  weibo: [["cookie", "WEIBO_COOKIE"], ["xsrfToken", "WEIBO_XSRF_TOKEN"]],
};

function fromEnv(collector: string): Record<string, string> | null {
  const spec = ENV_FALLBACK[collector];
  if (!spec) return null;
  const fields: Record<string, string> = {};
  for (const [key, env] of spec) {
    const value = process.env[env];
    if (value?.trim()) fields[key] = value.trim();
  }
  return Object.keys(fields).length ? fields : null;
}

/** 采集器要用的凭据；后台保存过就用后台的，否则看环境变量，都没有返回 null。 */
export async function getCredentials(collector: string): Promise<Record<string, string> | null> {
  const [row] = await sql<{ fields: Record<string, string> }[]>`SELECT fields FROM crawler_credentials WHERE collector = ${collector}`;
  return row ? row.fields : fromEnv(collector);
}

export interface CredentialState {
  collector: string;
  fields: Record<string, string>;
  updatedAt: Date | null;
  updatedBy: string | null;
  from: "admin" | "env";
}

export async function credentialState(collector: string): Promise<CredentialState | null> {
  const [row] = await sql<{ fields: Record<string, string>; updated_at: Date; updated_by: string | null }[]>`
    SELECT fields, updated_at, updated_by FROM crawler_credentials WHERE collector = ${collector}`;
  if (row) return { collector, fields: row.fields, updatedAt: row.updated_at, updatedBy: row.updated_by, from: "admin" };
  const env = fromEnv(collector);
  return env ? { collector, fields: env, updatedAt: null, updatedBy: null, from: "env" } : null;
}

const maskedFields = (fields: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, maskSecret(value)]));

export async function saveCredentials(collector: string, fields: Record<string, string>, actor: string): Promise<void> {
  const [before] = await sql<{ fields: Record<string, string> }[]>`SELECT fields FROM crawler_credentials WHERE collector = ${collector}`;
  await sql`INSERT INTO crawler_credentials (collector, fields, updated_at, updated_by)
            VALUES (${collector}, ${sql.json(fields as never)}, now(), ${actor})
            ON CONFLICT (collector) DO UPDATE
              SET fields = EXCLUDED.fields, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  // 保存登录态也是人工改动：审计里只留掩码，不写整条 cookie。
  await audit(actor, "crawler.credentials", `crawler:${collector}`, null, before ? maskedFields(before.fields) : null, maskedFields(fields));
}

/** 只露出尾部几位，够确认「粘的是哪一版」，不把整条凭据发回浏览器。 */
export { maskSecret as maskValue };
