// Feed filters: the channel and category choice (a row of tabs on desktop, a sheet behind the bar's filter
// button on phones), the phone bar of 精选 and 全部, and search.
import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { CATEGORY_KEYS, CATEGORY_LABELS, CHANNEL_LABELS, type CategoryKey, type ChannelKey } from "@aihot/contracts/taxonomy";
import type { CompanyOption, EntityFilter, SourceOption, SourcePlatformOption } from "@aihot/contracts/site";
import { SITE } from "@aihot/site";
import { IconCheck, IconChevronDown, IconClose, IconFilter, IconSearch } from "../../components/icons";
import { PillTabs } from "../../components/ui/Tabs";
import { Sheet } from "../../components/ui/Sheet";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import { BarButton, PhoneBar } from "../../components/shell/PhoneBar";
import { openSearch } from "../search/SearchOverlay";

const PLATFORM_LABELS: Record<string, string> = {
  weibo: "微博", mp_account: "公众号", x_search: "X", rss: "RSS", web_list: "网页", json_list: "JSON", external: "外部上报",
};
export const platformLabel = (kind: string) => PLATFORM_LABELS[kind] ?? kind;

/** Same page with some query parameters changed (paging state dropped). */
function hrefWith(base: string, params: URLSearchParams, patch: Record<string, string | null>) {
  const sp = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  sp.delete("page");
  sp.delete("cursor");
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * The feed's one filter (精选 and 全部动态 alike): none, 一手, or a category. One choice at a time: picking
 * 一手 clears the category and picking a category clears 一手. Older 资讯 / X links still filter; the
 * choice then shows as none.
 */
function filterOptions(base: string, params: URLSearchParams, noneLabel: string) {
  return [
    { key: "all", label: noneLabel, to: hrefWith(base, params, { category: null, channel: null }) },
    { key: "firstParty", label: CHANNEL_LABELS.firstParty, to: hrefWith(base, params, { category: null, channel: "firstParty" }) },
    ...CATEGORY_KEYS.map((k) => ({ key: k, label: CATEGORY_LABELS[k], to: hrefWith(base, params, { category: k, channel: null }) })),
  ];
}

function filterKey(category: CategoryKey | null, channel: ChannelKey): string {
  return channel === "firstParty" ? "firstParty" : (category ?? "all");
}

/**
 * Desktop: the filter as a row of tabs beside the search field. It carries the same label as the
 * company row under it (类别 / 公司), so the two rows read as two dimensions rather than two lists.
 */
export function CategoryTabs({ base, category, channel = "all", layoutId, className = "" }: { base: string; category: CategoryKey | null; channel?: ChannelKey; layoutId: string; className?: string }) {
  const [params] = useSearchParams();
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <span className="shrink-0 text-[13px] font-medium text-ink-3">类别</span>
      <PillTabs items={filterOptions(base, params, "全部").map(o => ({ ...o, prefetch: 'intent' as const }))} active={filterKey(category, channel)} layoutId={layoutId} label="按类别筛选" className="min-w-0" />
    </div>
  );
}

/**
 * The phone bar of 精选 and 全部: the brand, the 精选 | 全部 switch (a filter in use carries over), and
 * buttons for the filter sheet and search.
 */
export function FeedBar({ base, category, channel, entity = null, companies = [], source = null, sources = [], platforms = [] }: { base: "/" | "/all"; category: CategoryKey | null; channel: ChannelKey; entity?: EntityFilter | null; companies?: CompanyOption[]; source?: string | null; sources?: SourceOption[]; platforms?: SourcePlatformOption[] }) {
  const [params] = useSearchParams();
  const [sheet, setSheet] = useState(false);
  const scope = (to: string) => hrefWith(to, params, { q: null, tab: null, search: null });
  const filtered = filterKey(category, channel) !== "all" || !!source || !!entity;
  return (
    <>
      <PhoneBar
        leading={
          <Link to="/" aria-label={`${SITE.name} 首页`} className="flex h-11 items-center pl-2.5 pr-2 text-ink">
            <Wordmark size={17} />
          </Link>
        }
        center={
          <PillTabs
            size="sm"
            layoutId="feed-scope"
            label="看精选或全部"
            active={base === "/" ? "featured" : "all"}
            items={[
              { key: "featured", label: "精选", to: scope("/"), resetScroll: true, prefetch: 'intent' },
              { key: "all", label: "全部", to: scope("/all"), resetScroll: true, prefetch: 'intent' },
            ]}
          />
        }
        actions={
          <>
            <BarButton label={filtered ? "筛选（已选）" : "筛选"} on={filtered} onClick={() => setSheet(true)}>
              <IconFilter size={21} />
              {filtered && <span aria-hidden="true" className="absolute right-[9px] top-[9px] size-[7px] rounded-full bg-accent ring-2 ring-bg" />}
            </BarButton>
            <SearchButton />
          </>
        }
      />
      <FilterSheet open={sheet} onClose={() => setSheet(false)} base={base} active={filterKey(category, channel)} entity={entity} companies={companies} source={source} sources={sources} platforms={platforms} />
    </>
  );
}

/** Phones: the filter as a sheet of options, the one in use ticked; choosing one applies it. */
function FilterSheet({ open, onClose, base, active, entity, companies, source, sources, platforms }: { open: boolean; onClose: () => void; base: string; active: string; entity: EntityFilter | null; companies: CompanyOption[]; source: string | null; sources: SourceOption[]; platforms: SourcePlatformOption[] }) {
  const [params] = useSearchParams();
  const row = (on: boolean) => `-mx-2 flex h-12 items-center justify-between rounded-tile px-2 text-[16px] transition-colors active:bg-bg-sunk ${on ? "font-semibold text-accent" : "text-ink"}`;
  return (
    <Sheet open={open} onClose={onClose} title="筛选">
      <ul className="mx-4 divide-y divide-line-soft">
        {filterOptions(base, params, "不限").map((o) => {
          const on = o.key === active;
          return (
            <li key={o.key}>
              <Link
                to={o.to}
                onClick={onClose}
                aria-current={on ? "true" : undefined}
                className={row(on)}
              >
                {o.label}
                {on && <IconCheck size={19} strokeWidth={2.2} />}
              </Link>
            </li>
          );
        })}
      </ul>
      {(sources.length > 0 || platforms.length > 0) && (
        <>
          <h3 className="mx-4 mb-1 mt-5 text-[13px] font-semibold text-ink-3">来源</h3>
          <ul className="mx-4 divide-y divide-line-soft">
            {[
              { key: "", label: "不限", on: !source },
              ...platforms.filter((p) => p.kind === "weibo" || p.kind === "mp_account" || p.kind === "x_search")
                .map((p) => ({ key: `kind:${p.kind}`, label: `${platformLabel(p.kind)} ${p.count}`, on: source === `kind:${p.kind}` })),
              ...sources.map((s) => ({ key: s.id, label: `${s.name} ${s.count}`, on: source === s.id })),
            ].map((item, i) => (
              <li key={item.key || `source-none-${i}`}>
                <Link to={hrefWith(base, params, { source: item.key || null })} onClick={onClose} aria-current={item.on ? "true" : undefined} className={row(item.on)}>
                  <span className="truncate">{item.label}</span>
                  {item.on && <IconCheck size={19} strokeWidth={2.2} />}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {companies.length > 0 && (
        <>
          <h3 className="mx-4 mb-1 mt-5 text-[13px] font-semibold text-ink-3">公司</h3>
          <ul className="mx-4 divide-y divide-line-soft">
            {([null, ...companies] as Array<CompanyOption | null>).map((c, i) => {
              const on = c ? c.id === entity?.id : !entity;
              return (
                <li key={c?.id ?? `none-${i}`}>
                  <Link to={hrefWith(base, params, { entity: c?.id ?? null })} onClick={onClose} aria-current={on ? "true" : undefined} className={row(on)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{c?.name ?? "不限"}</span>
                      {!!c?.count && <span className="num text-[13px] text-ink-4">{c.count}</span>}
                    </span>
                    {on && <IconCheck size={19} strokeWidth={2.2} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}

/** The filters in use, as chips under the bar; each one clears itself when tapped. */
export function ActiveFilters({ base, category, channel, entity = null, tag, source = null, sourceLabel = null }: { base: string; category: CategoryKey | null; channel: ChannelKey; entity?: EntityFilter | null; tag: string | null; source?: string | null; sourceLabel?: string | null }) {
  const [params] = useSearchParams();
  const label = channel === "firstParty" ? CHANNEL_LABELS.firstParty : category ? CATEGORY_LABELS[category] : null;
  const q = params.get("q")?.trim() ?? "";
  const chips: Array<{ key: string; text: string; clear: Record<string, string | null> }> = [];
  if (label) chips.push({ key: "scope", text: `只看${label}`, clear: { category: null, channel: null } });
  if (entity) chips.push({ key: "entity", text: `公司：${entity.name}`, clear: { entity: null } });
  if (source) chips.push({ key: "source", text: `来源：${sourceLabel ?? source}`, clear: { source: null } });
  if (tag) chips.push({ key: "tag", text: `#${tag}`, clear: { tag: null } });
  if (q) chips.push({ key: "q", text: `搜索：${q}`, clear: { q: null } });
  if (!chips.length) return null;
  const chip = "inline-flex min-h-11 max-w-full items-center gap-1 rounded-full bg-accent-soft pl-3 pr-2 text-[13px] font-medium text-accent transition-opacity active:opacity-60 lg:min-h-8 lg:pl-2.5 lg:text-[12.5px]";
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 pt-1">
      {chips.map((c) => (
        <Link key={c.key} to={hrefWith(base, params, c.clear)} aria-label={`取消：${c.text}`} className={chip}>
          <span className="truncate">{c.text}</span>
          <IconClose size={14} strokeWidth={2} className="shrink-0" />
        </Link>
      ))}
      {chips.length > 1 && (
        <Link to={hrefWith(base, params, { category: null, channel: null, entity: null, tag: null, source: null, q: null })} className="text-[13px] text-ink-3 underline-offset-2 transition-colors hover:text-accent hover:underline">
          全部清空
        </Link>
      )}
    </div>
  );
}

/** How many companies the row shows before 更多公司. */
const COMPANY_ROW = 9;

/**
 * The company row: its own dimension beside the categories, so a reader can narrow to one company
 * without giving up the category. Only companies with content are offered, most content first.
 */
export function SourceTabs({ base, source, sources, platforms }: { base: string; source: string | null; sources: SourceOption[]; platforms: SourcePlatformOption[] }) {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  if (!sources.length && !platforms.length) return null;
  const platformItems = platforms
    .filter((p) => p.kind === "weibo" || p.kind === "mp_account" || p.kind === "x_search")
    .map((p) => ({ key: `kind:${p.kind}`, label: `${platformLabel(p.kind)} ${p.count}`, value: `kind:${p.kind}` }));
  const sourceItems = sources.map((s) => ({ key: s.id, label: `${s.name} ${s.count}`, value: s.id }));
  const items = [...platformItems, ...sourceItems];
  const more = items.length > 8;
  const shown = open || !more ? items : items.slice(0, 8);
  return (
    <div className="mb-4 hidden items-center gap-3 lg:flex">
      <span className="shrink-0 text-[13px] font-medium text-ink-3">来源</span>
      <PillTabs
        size="sm"
        layoutId="source-row"
        label="按来源筛选"
        active={source ?? ""}
        wrap={open}
        className="min-w-0"
        items={[
          { key: "", label: "不限", to: hrefWith(base, params, { source: null }), prefetch: "intent" as const },
          ...shown.map((item) => ({
            key: item.key,
            label: item.label,
            to: hrefWith(base, params, { source: item.value }),
            prefetch: "intent" as const,
          })),
        ]}
      />
      {more && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "收起来源" : "展开全部来源"}
          title={open ? "收起" : "全部来源"}
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink-2 lg:size-7"
        >
          <IconChevronDown size={15} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}

export function CompanyTabs({ base, entity, companies }: { base: string; entity: EntityFilter | null; companies: CompanyOption[] }) {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  if (!companies.length) return null;
  const more = companies.length > COMPANY_ROW;
  const shown = open || !more ? companies : companies.slice(0, COMPANY_ROW);
  return (
    <div className="mb-4 hidden items-center gap-3 lg:flex">
      <span className="shrink-0 text-[13px] font-medium text-ink-3">公司</span>
      <PillTabs
        size="sm"
        layoutId="company-row"
        label="按公司筛选"
        active={entity?.id ?? ""}
        wrap={open}
        className="min-w-0"
        items={[
          { key: "", label: "不限", to: hrefWith(base, params, { entity: null }), prefetch: "intent" as const },
          ...shown.map((c) => ({
            key: c.id,
            label: (
              <span className="flex items-center gap-1">
                {c.name}
                <span className="num text-[11.5px] text-ink-4">{c.count}</span>
              </span>
            ),
            to: hrefWith(base, params, { entity: c.id }),
            prefetch: "intent" as const,
          })),
        ]}
      />
      {more && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "收起公司" : "展开全部公司"}
          title={open ? "收起" : "全部公司"}
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink-2 lg:size-7"
        >
          {/* Opening wraps the rest of the list onto the lines below: the arrow points down, then up. */}
          <IconChevronDown size={15} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}

/** Phones: the magnifier in a bar; the search opens over the page with the keyboard up. */
function SearchButton() {
  return (
    <BarButton label="搜索" onClick={(event) => openSearch("", event.currentTarget)}>
      <IconSearch size={21} />
    </BarButton>
  );
}

function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

/** Desktop search field (GET /all?q=…): at the end of the filter row as the same grey track, at the height of md tabs, with a "/" hint. */
export function SearchField({ defaultValue = "", keep = {} }: { defaultValue?: string; keep?: Record<string, string | null> }) {
  const [value, setValue] = useState(defaultValue);
  const navigation = useNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(defaultValue), [defaultValue]);
  useSlashFocus(inputRef);
  const searching = navigation.state === "loading" && navigation.location?.pathname === "/all" && !!new URLSearchParams(navigation.location.search).get("q");
  const hidden = Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null));

  return (
    <Form method="get" action="/all" role="search" className="group relative w-full shrink-0 lg:w-60">
      {hidden}
      <label htmlFor="site-search" className="sr-only">
        搜索标题、摘要与正文
      </label>
      <IconSearch size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${searching ? "text-accent" : "text-ink-4 group-focus-within:text-ink-3"}`} />
      <input
        ref={inputRef}
        id="site-search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="搜索标题、摘要…"
        maxLength={200}
        autoComplete="off"
        className="h-[42px] w-full rounded-full bg-bg-sunk pl-10 pr-10 text-[14px] text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent dark:bg-bg-muted/60 dark:focus:bg-surface"
      />
      {value ? (
        <button
          type="button"
          aria-label="清空"
          onClick={() => {
            setValue("");
            inputRef.current?.focus();
          }}
          className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink"
        >
          <IconClose size={13} />
        </button>
      ) : (
        <kbd className="mono pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-mark border border-line-strong bg-surface px-1.5 text-[10.5px] leading-4 text-ink-4 lg:block">/</kbd>
      )}
    </Form>
  );
}
