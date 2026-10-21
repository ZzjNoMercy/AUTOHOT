/** 采集器交给引擎的一条内容。正文由采集器提供——财联社和微博的原文页框架抓不到（需签名/登录态）。 */
export interface CrawledItem {
  url: string;
  title: string;
  bodyText: string;
  publishedAt: Date | null;
  author?: string | null;
}

/** 一次采集的结果：条目，以及账号自己的信息（微博账号当前的头像）。 */
export interface CollectResult {
  items: CrawledItem[];
  /** 账号当前头像的地址；站点和快讯源没有。 */
  avatar?: string | null;
}
