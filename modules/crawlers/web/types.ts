// 后台「采集」页的数据形状：账号按平台分开，财联社的话题订阅单独一份。
export interface CredentialState {
  saved: boolean;
  from: "admin" | "env" | null;
  updatedAt: string | null;
  updatedBy: string | null;
  masked: Record<string, string> | null;
}

export interface Topic {
  id: string;
  name: string;
}

interface SourceState {
  enabled: boolean;
  participation_mode: string;
  tier: string;
  health: string;
  interval_minutes: number;
  lastOkAt: string | null;
  last_error: string | null;
}

export interface WeiboRow extends SourceState {
  source_id: string;
  collector: string;
  account: string | null;
  label: string | null;
  name: string;
  /** 页面上显示的头像（采集时自动取到的，或手动填的）。 */
  icon: string | null;
  /** 手动填的头像；空表示跟着采集结果走。 */
  iconOverride: string | null;
}

export type WereadAuthStatus = "missing" | "pending" | "valid" | "invalid" | "unknown";
export type WereadCapability = "unknown" | "latest_only" | "list_available" | "blocked";

export interface WereadAuthView {
  status: WereadAuthStatus;
  validatedAt: string | null;
  lastErrorCode: string | null;
  blockedUntil: string | null;
  loginPending: boolean;
  maskedVid: string | null;
}

export interface WereadArticle {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  firstSeenAt: string;
  bodyStatus: "pending" | "ok" | "unconfirmed" | "none";
  contentStatus: "pending" | "ready" | "failed" | null;
  contentError: string | null;
}

export interface MpFetchRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "ok" | "failed" | "skipped";
  foundCount: number;
  newCount: number;
  error: string | null;
  detail: {
    reason?: "schedule" | "manual";
    capability?: string;
    title?: string;
    reviewId?: string;
    articleId?: string;
    articleResult?: "created" | "already_stored";
    contentStatus?: "ready" | "failed";
    contentResult?: "fetched" | "already_ready" | "failed";
    contentErrorCode?: string | null;
    errorCode?: string;
  } | null;
}

export interface MpRow extends SourceState {
  source_id: string;
  name: string;
  ghid: string | null;
  icon: string | null;
  provider: "dajiala" | "weread";
  bookId: string | null;
  biz: string | null;
  sourceArticleUrl: string | null;
  wereadStatus: "pending_validation" | "active" | null;
  capability: WereadCapability | null;
  lastSeenReviewId: string | null;
  wereadError: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  updatedAt: string;
  articles: WereadArticle[];
  runs: MpFetchRun[];
}

export interface WereadPreview {
  resolved: { bookId: string; biz: string; numericId: string; articleUrl: string };
  duplicate: { sourceId: string; name: string } | null;
  name: string | null;
  nameSource: "article" | "weread" | null;
  status: "pending_validation" | "active";
  capability: WereadCapability;
  errorCode: string | null;
  message: string | null;
  latest: { title: string; reviewId: string; publishedAt: string | null } | null;
}

export interface WereadAddResult extends WereadPreview {
  created: boolean;
  sourceId?: string;
  authRequired?: boolean;
  check?: { status: string; contentStatus?: string; contentErrorCode?: string | null } | null;
}

export interface WereadQueueResult {
  queued: boolean;
  jobId?: string | null;
  reason: "missing" | "auth_required" | "rate_limited" | "already_queued" | null;
}

export interface ClsRow extends SourceState {
  source_id: string;
  name: string;
  /** 选中的话题；null 表示还没选过，按默认的五个抓。 */
  topics: Topic[] | null;
}

export interface Overview {
  weibo: { page: number; total: number; pageSize: number; registered: string[]; rows: WeiboRow[] };
  mp: { total: number; dajiala: boolean; rows: MpRow[] };
  cls: ClsRow | null;
  credential: CredentialState;
  weread: WereadAuthView;
  defaults: { weiboAccounts: Array<{ uid: string; name: string }>; clsTopics: Topic[] };
}
