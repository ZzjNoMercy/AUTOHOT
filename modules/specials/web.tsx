import type { WebModule } from "@aihot/web/modules";
import SpecialsSwitch from "./web/switch.tsx";

export const specialsWeb: WebModule = {
  name: "specials",
  // 专题不单独占导航：热点/专题 是同一个入口，页面顶部的切换负责两条列表。
  admin: {
    content: [{ to: "/admin/specials", label: "专题", count: "specials" }],
  },
  root: { Top: SpecialsSwitch },
};
