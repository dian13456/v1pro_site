import { DEFAULT_COLUMN_TAG_OPTIONS, type ColumnTagOption } from "../data/columnTags";
import { API_BASE } from "./httpClient";

const COLUMN_TAGS_API_URL = API_BASE ? `${API_BASE}/api/column-tags` : "/api/column-tags";

function normalizeColumnTags(payload: unknown): ColumnTagOption[] {
  if (!Array.isArray(payload)) {
    return DEFAULT_COLUMN_TAG_OPTIONS;
  }

  const options = payload
    .map((item) => {
      const record = item as Partial<ColumnTagOption>;
      const id = (record.id || "").trim();
      const label = (record.label || "").trim();
      const keywords = Array.isArray(record.keywords)
        ? record.keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
        : label
          ? [label]
          : [];
      if (!id || !label) {
        return null;
      }
      return { id, label, keywords: keywords.length > 0 ? keywords : [label] };
    })
    .filter((item): item is ColumnTagOption => item !== null);

  return options.length > 0 ? options : DEFAULT_COLUMN_TAG_OPTIONS;
}

export async function fetchColumnTags(): Promise<ColumnTagOption[]> {
  try {
    const response = await fetch(COLUMN_TAGS_API_URL, { cache: "no-store" });
    if (!response.ok) {
      return DEFAULT_COLUMN_TAG_OPTIONS;
    }
    const payload = await response.json();
    return normalizeColumnTags(payload);
  } catch {
    return DEFAULT_COLUMN_TAG_OPTIONS;
  }
}
