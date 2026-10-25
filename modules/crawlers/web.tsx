// 这个模块接进网页的插口：账号采集视图在「信源」内切换，不再单独占一个后台导航项。
// 页面本身在 web/page.tsx（module.ts 的 adminPages 指过去）。
import type { WebModule } from "@aihot/web/modules";

export const crawlersWeb: WebModule = {
  name: "crawlers",
  admin: {
    // 微博登录态卡片画在设置页的「采集凭据」下面。
    settingsCards: () => import("./web/settings-card.tsx"),
  },
};
