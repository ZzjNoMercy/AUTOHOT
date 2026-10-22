import { Link, useLocation } from "react-router";

/** The 热点 / 专题 switch above both pages; no other page sees it. */
export default function SpecialsSwitch() {
  const { pathname } = useLocation();
  if (pathname !== "/hot" && !pathname.startsWith("/specials")) return null;
  const current = pathname.startsWith("/specials") ? "/specials" : "/hot";
  const items = [
    { to: "/hot", label: "热点" },
    { to: "/specials", label: "专题" },
  ];
  return (
    <nav aria-label="热点与专题" className="mb-4 flex items-center gap-1 rounded-full bg-bg-sunk p-1 text-[13px] ring-1 ring-inset ring-line-soft w-fit">
      {items.map((item) => {
        const active = current === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
