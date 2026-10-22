// A conference/series special: several independent stories collected under one theme. Its pages live
// beside the engine's; the backend and web plugs are in server.ts and web.tsx.
import { defineModule } from "@aihot/contracts/modules";

export const specials = defineModule({
  name: "specials",
  pages: [
    { path: "specials", file: "web/list.tsx" },
    { path: "specials/:slug", file: "web/detail.tsx" },
  ],
  adminPages: [
    { path: "admin/specials", file: "web/admin.tsx", id: "admin-specials" },
    { path: "admin/specials/:id", file: "web/admin-detail.tsx" },
  ],
  apiPaths: [/^\/api\/specials/, /^\/api\/admin\/specials/],
});
