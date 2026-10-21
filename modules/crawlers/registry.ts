// 采集器的信源登记表：external 源的 config 有白名单（只允许发布方那几个字段），放不下「归哪个采集器管」，
// 所以模块自己记一份。建源仍走引擎的 createSource（校验 + 审计），注册表只加一层归属。
import { sql } from "@aihot/backend/db";
import { createSource } from "@aihot/backend/admin/sources";
import { audit } from "@aihot/backend/audit";

export const COLLECTORS = ["cls", "weibo"] as const;
export type Collector = (typeof COLLECTORS)[number];

export interface Topic { id: string; name: string }

/** 财联社的话题（原脚本里的 subject_dict）；后台可以只勾选其中几个。 */
export const CLS_TOPICS: ReadonlyArray<Topic> = [
  { id: "1090", name: "汽车大新闻" },
  { id: "1321", name: "人工智能" },
  { id: "1343", name: "智能驾驶" },
  { id: "1354", name: "新能源汽车" },
  { id: "3025", name: "固态电池" },
];

/** 微博账号的默认名单（来自原脚本的 users 表）；页面会把它填进输入框，你可以改。 */
export const DEFAULT_WEIBO_ACCOUNTS: ReadonlyArray<{ uid: string; name: string }> = [
  { uid: "3254988854", name: "向北不断电" },
  { uid: "2135129011", name: "孙少军09" },
  { uid: "7746667867", name: "HiEV大蒜粒车研所" },
  { uid: "6528484723", name: "新渠道-李霸天" },
  { uid: "2323195050", name: "Blood旌旗" },
  { uid: "5271269026", name: "杰兰路LandRoads" },
  { uid: "7978385742", name: "re65_LandRoads" },
  { uid: "5864631940", name: "自主品牌才是国之希望" },
  { uid: "1243861097", name: "李想" },
  { uid: "1749127163", name: "雷军" },
  { uid: "2455476364", name: "XP-何小鹏" },
  { uid: "2712644232", name: "迪梦人" },
  { uid: "1644088831", name: "新浪汽车" },
  { uid: "2689037485", name: "吴颖碎碎念" },
  { uid: "1871299764", name: "刘杰-理想" },
];

export interface CrawlerSourceRow {
  source_id: string;
  collector: string;
  account: string | null;
  label: string | null;
  name: string;
  enabled: boolean;
  participation_mode: string;
  tier: string;
  health: string;
  interval_minutes: number;
  last_ok_at: Date | null;
  last_error: string | null;
  /** 页面上显示的头像（sources.icon_url，自动取到的或手动填的）。 */
  icon: string | null;
  /** 手动填的头像；空表示跟着采集结果走。 */
  iconOverride: string | null;
}

/** 已登记的采集器信源 + 引擎那边的健康状态（后台页面用）。后台一页读多少行。 */
export const CRAWLER_PAGE_SIZE = 50;

/** 后台要的那一页微博账号，按信源 ID 稳定排序；总数交给页面判断还有没有下一页。 */
export async function weiboSourceRows(page = 1): Promise<{ rows: CrawlerSourceRow[]; total: number }> {
  const offset = (Math.max(1, Math.floor(page)) - 1) * CRAWLER_PAGE_SIZE;
  const [rows, [count]] = await Promise.all([
    sql<CrawlerSourceRow[]>`
      SELECT cs.source_id, cs.collector, cs.account, cs.label, s.name, s.enabled, s.participation_mode, s.tier,
             s.health, s.interval_minutes, s.last_ok_at, s.last_error,
             s.icon_url AS icon, cs.icon_url AS "iconOverride"
      FROM crawler_sources cs JOIN sources s ON s.id = cs.source_id
      WHERE cs.collector = 'weibo'
      ORDER BY cs.source_id
      LIMIT ${CRAWLER_PAGE_SIZE} OFFSET ${offset}`,
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM crawler_sources WHERE collector = 'weibo'`,
  ]);
  return { rows, total: count!.total };
}

/** 财联社那一条源：话题订阅挂在它上面，没建源时为空。 */
export interface ClsSourceRow {
  source_id: string;
  name: string;
  enabled: boolean;
  participation_mode: string;
  tier: string;
  health: string;
  interval_minutes: number;
  last_ok_at: Date | null;
  last_error: string | null;
  /** 选中的话题；null 表示还没选过，按默认的 CLS_TOPICS 抓。 */
  topics: Topic[] | null;
}

export async function clsSource(): Promise<ClsSourceRow | null> {
  const [row] = await sql<ClsSourceRow[]>`
    SELECT cs.source_id, s.name, s.enabled, s.participation_mode, s.tier, s.health, s.interval_minutes,
           s.last_ok_at, s.last_error, cs.topics
    FROM crawler_sources cs JOIN sources s ON s.id = cs.source_id
    WHERE cs.collector = 'cls' LIMIT 1`;
  return row ?? null;
}

/** 公众号清单（引擎的 mp_account 源）：账号由引擎的 mp 任务按频率检查，模块只管名单。 */
export interface MpSourceRow {
  source_id: string;
  name: string;
  ghid: string | null;
  enabled: boolean;
  participation_mode: string;
  tier: string;
  health: string;
  interval_minutes: number;
  last_ok_at: Date | null;
  last_error: string | null;
  icon: string | null;
}

export async function mpSourceRows(): Promise<MpSourceRow[]> {
  return sql<MpSourceRow[]>`
    SELECT id AS source_id, name, COALESCE(config ->> 'ghid', config ->> 'wxid') AS ghid, enabled, participation_mode, tier, health,
           interval_minutes, last_ok_at, last_error, icon_url AS icon
    FROM sources WHERE kind = 'mp_account'
    ORDER BY health = 'failing' DESC, name`;
}

/** 保存财联社的话题订阅（没有源就先建一个 ext-cls）。 */
export async function saveClsTopics(topics: Topic[], actor: string): Promise<void> {
  const [before] = await sql<{ topics: Topic[] | null }[]>`SELECT topics FROM crawler_sources WHERE source_id = 'ext-cls'`;
  await registerCrawlerSource({
    sourceId: "ext-cls", name: "财联社", collector: "cls", label: "财联社",
    tier: "T2", participationMode: "editorial", intervalMinutes: 60,
  }, actor);
  await sql`UPDATE crawler_sources SET topics = ${sql.json(topics as never)} WHERE source_id = 'ext-cls'`;
  await audit(actor, "crawler.topics", "crawler:cls", null, before?.topics ?? null, topics);
}

/** 这个源归谁管（采集器自己判断该不该接它）。 */
export async function collectorOf(sourceId: string): Promise<{ collector: string; account: string | null } | null> {
  const [row] = await sql<{ collector: string; account: string | null }[]>`
    SELECT collector, account FROM crawler_sources WHERE source_id = ${sourceId}`;
  return row ?? null;
}

export interface RegisterInput {
  sourceId: string;
  name: string;
  collector: Collector;
  account?: string | null;
  label?: string | null;
  tier?: string;
  participationMode?: string;
  intervalMinutes?: number;
}

/** 建引擎的信源（已存在就不动），再登记到模块的注册表。 */
export async function registerCrawlerSource(input: RegisterInput, actor: string): Promise<{ created: boolean }> {
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM sources WHERE id = ${input.sourceId}`;
  if (!existing) {
    await createSource({
      id: input.sourceId,
      name: input.name,
      // 微博是引擎的一等信源类型（channel = weibo，页面上标出平台）；财联社仍是外部上报。
      kind: input.collector === "weibo" ? "weibo" : "external",
      config: {},
      tier: input.tier ?? "T2",
      participation_mode: input.participationMode ?? "editorial",
      interval_minutes: input.intervalMinutes ?? 60,
      // Weibo accounts count as one public source; each account stays its own participant.
      source_group_id: input.collector === "weibo" ? "weibo" : null,
    }, actor);
  }
  await sql`INSERT INTO crawler_sources (source_id, collector, account, label)
            VALUES (${input.sourceId}, ${input.collector}, ${input.account ?? null}, ${input.label ?? null})
            ON CONFLICT (source_id) DO UPDATE
              SET collector = EXCLUDED.collector, account = EXCLUDED.account, label = EXCLUDED.label`;
  return { created: !existing };
}

/**
 * 采集时取到的头像：只在这个账号没手动填过头像时写进信源。
 * 引擎的图标任务不会再给微博源找 favicon（sources/icons.ts），这里就是它的头像来源。
 */
export async function saveCollectedIcon(sourceId: string, icon: string): Promise<void> {
  await sql`UPDATE sources s SET icon_url = ${icon}, icon_checked_at = now()
            FROM crawler_sources cs
            WHERE s.id = ${sourceId} AND cs.source_id = s.id AND cs.icon_url IS NULL
              AND s.icon_url IS DISTINCT FROM ${icon}`;
}

/** 手动填的头像 URL（空 = 取消手动，回到采集结果）。同时写进信源，改完立刻生效。 */
export async function setCrawlerIcon(sourceId: string, icon: string | null): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`UPDATE crawler_sources SET icon_url = ${icon} WHERE source_id = ${sourceId}`;
    if (icon) await tx`UPDATE sources SET icon_url = ${icon}, icon_checked_at = now() WHERE id = ${sourceId}`;
  });
}
