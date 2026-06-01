import { useEffect, useMemo, useState } from "react";
import type { ColumnTagFilter, MaterialTypeFilter, ResourceCategory, ResourceItem } from "../types/resource";
import { fetchResources } from "../services/resourceService";
import { resourceMatchesColumn } from "../utils/columnMatch";

export type ResourceSortMode = "latest" | "oldest" | "hot";

export function useResourceCatalog() {
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<ResourceCategory>("all");
  const [materialType, setMaterialType] = useState<MaterialTypeFilter>("all");
  const [columnTag, setColumnTag] = useState<ColumnTagFilter>("all");
  const [sortMode, setSortMode] = useState<ResourceSortMode>("latest");

  useEffect(() => {
    let active = true;
    fetchResources()
      .then((list) => {
        if (active) setResources(list);
      })
      .catch((err: unknown) => {
        if (active) setError((err as Error)?.message || "资源加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    const result = resources.filter((resource) => {
      const passCategory = category === "all" ? resource.category === "gif" : resource.category === category;
      if (!passCategory) return false;
      const passMaterialType =
        sortMode === "hot" && materialType === "all"
          ? resource.materialType === "video" || resource.materialType === "gif"
          : materialType === "all"
            ? true
            : resource.materialType === materialType;
      if (!passMaterialType) return false;
      if (columnTag !== "all" && !resourceMatchesColumn(resource, columnTag)) return false;
      if (!query) return true;
      return (
        resource.title.toLowerCase().includes(query) ||
        resource.description.toLowerCase().includes(query) ||
        (resource.author || "").toLowerCase().includes(query)
      );
    });
    result.sort((a, b) => {
      if (sortMode === "hot") return 0;
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      if (sortMode === "oldest") return aTime - bTime;
      return bTime - aTime;
    });
    return result;
  }, [resources, keyword, category, materialType, columnTag, sortMode]);

  return {
    resources,
    filtered,
    loading,
    error,
    keyword,
    setKeyword,
    category,
    setCategory,
    materialType,
    setMaterialType,
    columnTag,
    setColumnTag,
    sortMode,
    setSortMode,
  };
}
