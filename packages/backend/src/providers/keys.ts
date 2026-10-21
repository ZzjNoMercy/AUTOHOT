// The keys of paid collection services, saved on the admin settings page instead of an environment
// variable. The settings table is the source of truth and the environment is the fallback, so a
// deployment that already carries the variable keeps working unchanged. Saving takes effect on the
// provider's next call — no restart — and the value never travels back to the browser: the page and
// the audit log only ever see a mask.
import type { AdminProviderKey } from "@aihot/contracts/admin";
import { credential, type CredentialGroup } from "../config.ts";
import { sql } from "../db.ts";
import { maskSecret } from "../lib/secret.ts";
import { audit } from "../audit.ts";

/** The keys the settings page manages, and the credential group each one's variable belongs to. */
export const PROVIDER_KEYS = {
  DAJIALA_KEY: "collectors",
} as const satisfies Record<string, CredentialGroup>;

export type ProviderKeyName = keyof typeof PROVIDER_KEYS;

const SETTINGS_KEY = "provider_keys";

/** Whether a name is one the settings page manages (routes take names from requests). */
export function isProviderKeyName(name: string): name is ProviderKeyName {
  return Object.hasOwn(PROVIDER_KEYS, name);
}

async function saved(): Promise<Partial<Record<ProviderKeyName, string>>> {
  const [row] = await sql<{ value: Partial<Record<ProviderKeyName, string>> }[]>`SELECT value FROM settings WHERE key = ${SETTINGS_KEY}`;
  return row?.value ?? {};
}

/** The key a paid provider carries: what an operator saved in the backend, else the environment variable. */
export async function providerKey(name: ProviderKeyName): Promise<string | null> {
  const own = (await saved())[name];
  if (own?.trim()) return own.trim();
  return credential(PROVIDER_KEYS[name], name);
}

/** What the settings page shows: where each key comes from, and its masked tail. */
export async function providerKeyStates(): Promise<AdminProviderKey[]> {
  const stored = await saved();
  return (Object.keys(PROVIDER_KEYS) as ProviderKeyName[]).map((name) => {
    const own = stored[name]?.trim();
    if (own) return { name, from: "admin", masked: maskSecret(own) };
    const env = credential(PROVIDER_KEYS[name], name);
    return { name, from: env ? "env" : null, masked: env ? maskSecret(env) : null };
  });
}

/** Saves one key and returns its new state; the value itself is never returned. */
export async function saveProviderKey(name: ProviderKeyName, value: string, actor: string): Promise<AdminProviderKey> {
  const clean = value.trim();
  if (!clean || clean.length > 200 || /\s/.test(clean)) throw new Error("密钥不能为空、不能超过 200 个字符，也不能包含空白字符");
  const before = (await saved())[name] ?? null;
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${SETTINGS_KEY}, ${sql.json({ [name]: clean })}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, "settings.provider_key", `settings:${SETTINGS_KEY}`, null,
    { [name]: before ? maskSecret(before) : null }, { [name]: maskSecret(clean) });
  return { name, from: "admin", masked: maskSecret(clean) };
}

/** Forgets the saved key: the provider falls back to the environment variable, or stops asking. */
export async function clearProviderKey(name: ProviderKeyName, actor: string): Promise<AdminProviderKey> {
  const before = (await saved())[name] ?? null;
  await sql`UPDATE settings SET value = value - ${name}, updated_by = ${actor}, updated_at = now() WHERE key = ${SETTINGS_KEY}`;
  await audit(actor, "settings.provider_key_clear", `settings:${SETTINGS_KEY}`, null, { [name]: before ? maskSecret(before) : null }, null);
  const env = credential(PROVIDER_KEYS[name], name);
  return { name, from: env ? "env" : null, masked: env ? maskSecret(env) : null };
}
