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

export interface MpRow extends SourceState {
  source_id: string;
  name: string;
  ghid: string | null;
  icon: string | null;
}

export interface ClsRow extends SourceState {
  source_id: string;
  name: string;
  /** 选中的话题；null 表示还没选过，按默认的五个抓。 */
  topics: Topic[] | null;
}

export interface Overview {
  weibo: { page: number; total: number; pageSize: number; rows: WeiboRow[] };
  mp: { total: number; dajiala: boolean; rows: MpRow[] };
  cls: ClsRow | null;
  credential: CredentialState;
  defaults: { weiboAccounts: Array<{ uid: string; name: string }>; clsTopics: Topic[] };
}
