import { useEffect, useMemo, useState } from "react";
import type { MaterialTypeFilter, ResourceCategory, ResourceItem } from "../types/resource";
import { fetchResources } from "../services/resourceService";

export function useResourceCatalog() {
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<ResourceCategory>("all");
  const [materialType, setMaterialType] = useState<MaterialTypeFilter>("all");

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
    return resources.filter((resource) => {
      const passCategory = category === "all" ? true : resource.category === category;
      if (!passCategory) return false;
      const passMaterialType = materialType === "all" ? true : resource.materialType === materialType;
      if (!passMaterialType) return false;
      if (!query) return true;
      return (
        resource.title.toLowerCase().includes(query) ||
        resource.description.toLowerCase().includes(query)
      );
    });
  }, [resources, keyword, category, materialType]);

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
  };
}
