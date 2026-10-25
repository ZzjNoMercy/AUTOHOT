import { useNavigate } from "react-router";
import { PillTabs } from "../../components/ui/Tabs";

export function SourceCollectionTabs({ active }: { active: "sources" | "crawlers" }) {
  const navigate = useNavigate();
  return (
    <div className="mb-5">
      <PillTabs
        items={[
          { key: "sources", label: "全部信源" },
          { key: "crawlers", label: "账号采集" },
        ]}
        active={active}
        onSelect={(key) => navigate(key === "sources" ? "/admin/sources" : "/admin/crawlers")}
        layoutId="admin-source-collection"
        size="sm"
        label="信源与采集"
      />
    </div>
  );
}
