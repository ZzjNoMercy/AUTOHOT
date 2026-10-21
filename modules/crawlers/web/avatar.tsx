// 账号头像：采集时自动取到的图，手动填的优先；没有图就用名字首字。
import { useState } from "react";

export function Avatar({ name, src }: { name: string; src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img src={src} alt="" width={28} height={28} loading="lazy" className="size-7 shrink-0 rounded-full bg-bg-sunk object-cover ring-1 ring-line" onError={() => setFailed(true)} />;
  }
  return (
    <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-bg-sunk text-[12px] font-medium text-ink-3 ring-1 ring-line">
      {[...name][0] ?? "?"}
    </span>
  );
}
