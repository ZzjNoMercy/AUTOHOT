// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import { crawlersWeb } from "@aihot/crawlers/web";
import { specialsWeb } from "@aihot/specials/web";

export const WEB_MODULES: readonly WebModule[] = [crawlersWeb, specialsWeb];
