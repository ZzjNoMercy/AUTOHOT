/** A secret never travels back to a browser: show only the tail, enough to tell one version from another. */
export function maskSecret(value: string): string {
  const v = value.trim();
  return v.length <= 8 ? "•".repeat(v.length) : `${"•".repeat(8)}${v.slice(-6)}`;
}
