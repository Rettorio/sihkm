import { useCallback, useRef, useEffect } from "react";
import { canPrefetch } from "~/lib/prefetch-utils";

const PREFETCH_DEBOUNCE_MS = 300;

export function usePrefetch() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const schedule = useCallback((urls: string[]) => {
    if (!canPrefetch()) return;

    const newUrls = urls.filter(u => !inflightRef.current.has(u));
    if (newUrls.length === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      for (const url of newUrls) {
        inflightRef.current.add(url);
        fetch(url, { priority: "low" as any })
          .then(() => {})
          .catch(() => {})
          .finally(() => {
            setTimeout(() => inflightRef.current.delete(url), 10_000);
          });
      }
    }, PREFETCH_DEBOUNCE_MS);
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    inflightRef.current.clear();
  }, []);

  return { schedule, cancel };
}
