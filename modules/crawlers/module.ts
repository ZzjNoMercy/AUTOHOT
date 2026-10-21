// 这个模块的地址：后台「采集」页，以及它自己的接口（/api/admin/crawlers*，由 api 进程应答）。
import { defineModule } from "@aihot/contracts/modules";

export const crawlers = defineModule({
  name: "crawlers",
  adminPages: [{ path: "admin/crawlers", file: "web/page.tsx" }],
  apiPaths: [/^\/api\/admin\/crawlers/],
});
