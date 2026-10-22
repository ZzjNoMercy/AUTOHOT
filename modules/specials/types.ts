// Shapes shared by the specials API and its pages. Timestamps cross the API as ISO strings.

export interface SpecialCandidate {
  /** Normalized identity used to ignore the candidate. */
  key: string;
  name: string;
  reportCount: number;
  sourceCount: number;
  firstAt: string | null;
  lastAt: string | null;
  samples: string[];
}

export interface SpecialReportItem {
  id: string;
  title: string;
  summary: string | null;
  sourceName: string;
  publishedAt: string;
  selected: boolean;
  storyPublicId: string | null;
  storyTitle: string | null;
}

export interface SpecialTimelineItem {
  /** Null for a standalone report outside a story. */
  storyPublicId: string | null;
  title: string;
  latestAt: string;
  reportCount: number;
  sourceCount: number;
  report: SpecialReportItem | null;
}

export interface SpecialListItem {
  slug: string;
  title: string;
  intro: string | null;
  digest: string | null;
  startsAt: string | null;
  endsAt: string | null;
  coverUrl: string | null;
  reportCount: number;
  storyCount: number;
  sourceCount: number;
  updatedAt: string;
}

export interface SpecialDetail extends SpecialListItem {
  participants: string[];
  timeline: SpecialTimelineItem[];
  reports: SpecialReportItem[];
}

export interface SpecialsResponse {
  specials: SpecialListItem[];
}

export interface SpecialResponse {
  special: SpecialDetail;
}

// Admin

export interface AdminSpecialListItem extends SpecialListItem {
  id: number;
  status: "draft" | "published" | "archived";
  aliases: string[];
}

export interface AdminSpecialReport {
  articleId: string;
  title: string;
  sourceName: string;
  publishedAt: string;
  selected: boolean;
  source: "auto" | "manual";
  storyPublicId: string | null;
}

export interface AdminSpecialDetail extends AdminSpecialListItem {
  reports: AdminSpecialReport[];
}

export interface AdminSpecialsResponse {
  specials: AdminSpecialListItem[];
  candidates: SpecialCandidate[];
}

export interface AdminSpecialResponse {
  special: AdminSpecialDetail;
}
