import { useEffect, useMemo, useState } from "react";
import { buildColumnTagFilterOptions, type ColumnTagOption } from "../data/columnTags";
import { fetchColumnTags } from "../services/columnTagService";

export function useColumnTags() {
  const [options, setOptions] = useState<ColumnTagOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchColumnTags()
      .then((items) => {
        if (active) {
          setOptions(items);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const filterOptions = useMemo(() => buildColumnTagFilterOptions(options), [options]);

  return {
    columnTagOptions: options,
    columnTagFilterOptions: filterOptions,
    columnTagsLoading: loading,
  };
}
