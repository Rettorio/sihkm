import { useNavigation } from "react-router";
import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "loading" | "done";

export function NavigationProgress() {
  const { state } = useNavigation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [width, setWidth] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (state !== "idle") {
      clearTimeout(timer.current);
      if (raf.current) cancelAnimationFrame(raf.current);
      setPhase("loading");
      setWidth(0);
      // Double RAF: first frame renders at 0%, second triggers the CSS transition to 85%
      raf.current = requestAnimationFrame(() => {
        raf.current = requestAnimationFrame(() => setWidth(85));
      });
    } else if (phase === "loading") {
      if (raf.current) cancelAnimationFrame(raf.current);
      setWidth(100);
      setPhase("done");
      timer.current = setTimeout(() => setPhase("idle"), 400);
    }
    return () => {
      clearTimeout(timer.current);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [state, phase]);

  if (phase === "idle") return null;

  return (
    <div
      className="fixed top-0 left-0 z-[9999] h-[2px] pointer-events-none"
      style={{
        width: `${width}%`,
        opacity: phase === "done" ? 0 : 1,
        backgroundColor: "var(--brand-blue)",
        boxShadow: "0 0 8px color-mix(in srgb, var(--brand-blue) 60%, transparent)",
        transition:
          phase === "done"
            ? "width 200ms ease-in, opacity 300ms ease-in 100ms"
            : "width 2000ms cubic-bezier(0.05, 0.8, 0.1, 1)",
      }}
    />
  );
}
