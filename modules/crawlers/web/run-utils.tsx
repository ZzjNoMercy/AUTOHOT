import { Badge } from "@aihot/web/features/admin/ui";
import type { MpFetchRun } from "./types";

const RUN_STATUS = {
  ok: { label: "成功", tone: "ok" },
  failed: { label: "失败", tone: "bad" },
  skipped: { label: "跳过", tone: "muted" },
  running: { label: "进行中", tone: "accent" },
} as const;

export function FetchRunBadge({ run }: { run: MpFetchRun }) {
  const status = RUN_STATUS[run.status];
  return <Badge tone={status.tone}>{status.label}</Badge>;
}
