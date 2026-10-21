// 这个模块接进网页的插口：后台导航里加一项「采集」（在引擎的「信源」之后）。
// 页面本身在 web/page.tsx（module.ts 的 adminPages 指过去）。
import type { WebModule } from "@aihot/web/modules";

export const crawlersWeb: WebModule = {
  name: "crawlers",
  admin: {
    content: [{ to: "/admin/crawlers", label: "采集" }],
    // 微博登录态卡片画在设置页的「采集凭据」下面。
    settingsCards: () => import("./web/settings-card.tsx"),
  },
};
