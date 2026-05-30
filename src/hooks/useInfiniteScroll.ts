import { useEffect, useMemo, useRef, useState } from "react";

export function useInfiniteScroll<T>(items: T[], pageSize = 16) {
  const [page, setPage] = useState(1);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPage(1);
  }, [items]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first.isIntersecting) return;
        setPage((prev) => prev + 1);
      },
      { rootMargin: "250px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const visibleItems = useMemo(() => items.slice(0, page * pageSize), [items, page, pageSize]);
  const hasMore = visibleItems.length < items.length;

  return { visibleItems, hasMore, sentinelRef };
}
