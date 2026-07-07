import { ExternalLink } from "lucide-react";

const SOURCES = {
  sp2kp: { label: "SP2KP Kemendag", url: "https://sp2kp.kemendag.go.id/" },
  pihps:  { label: "PIHPS Bank Indonesia", url: "https://www.bi.go.id/hargapangan/" },
} as const;

type SourceKey = keyof typeof SOURCES;

export function DataSourceFooter({ sources }: { sources: SourceKey[] }) {
  return (
    <div className="mt-6 px-4 sm:px-6 py-3 border-t border-border flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-steel/40">
      <span className="font-semibold uppercase tracking-widest mr-1">Sumber</span>
      {sources.map((key, i) => (
        <span key={key} className="inline-flex items-center gap-1">
          {i > 0 && <span className="mx-1 opacity-40">·</span>}
          <a
            href={SOURCES[key].url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 hover:text-steel transition-colors group"
          >
            {SOURCES[key].label}
            <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-70 transition-opacity" />
          </a>
        </span>
      ))}
    </div>
  );
}
