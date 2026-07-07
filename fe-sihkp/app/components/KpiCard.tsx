import { useState } from "react";
import { Info } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

export function KpiHintTip({ hint }: { hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <p
          className="text-xs text-steel mt-1 truncate cursor-help"
          onClick={() => setOpen(v => !v)}
        >
          {hint}
        </p>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-50 text-xs">
        <p>{hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function KpiDefinitionTip({ definition }: { definition: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <span
          className="text-steel/40 hover:text-steel cursor-help transition-colors"
          onClick={() => setOpen(v => !v)}
        >
          <Info className="h-3 w-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-56 text-xs">
        <p>{definition}</p>
      </TooltipContent>
    </Tooltip>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  definition?: string;
  valueClass?: string;
  isLoading?: boolean;
  icon?: React.ReactNode;
  /** Override the Card's sizing/snap classes. Defaults to `min-w-56 max-w-56`. */
  className?: string;
  /** When true, the card uses a fixed 88px height with flex layout so all cards align. */
  fixedHeight?: boolean;
}

export function KpiCard({
  label,
  value,
  hint,
  definition,
  valueClass = "",
  isLoading = false,
  icon,
  className = "min-w-56 max-w-56",
  fixedHeight = false,
}: KpiCardProps) {
  const contentCls = `px-4${fixedHeight ? " h-[88px] flex flex-col justify-between" : ""}`;

  if (isLoading) {
    return (
      <Card className={`py-3 shrink-0 snap-start ${className}`}>
        <CardContent className="px-4 h-[88px] flex flex-col justify-between">
          <div className="h-3 w-full bg-muted animate-pulse rounded" />
          <div className="h-7 w-full bg-muted animate-pulse rounded" />
          <div className="h-3 w-3/4 bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`py-3 shrink-0 snap-start ${className}`}>
      <CardContent className={contentCls}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-steel">{label}</p>
            {definition && <KpiDefinitionTip definition={definition} />}
          </div>
          {icon && <span className="text-steel/50">{icon}</span>}
        </div>
        <p className={`text-2xl font-semibold text-ink tabular-nums leading-tight${fixedHeight ? "" : " mt-1"} ${valueClass}`}>
          {value}
        </p>
        {fixedHeight
          ? <div className="h-4">{hint ? <KpiHintTip hint={hint} /> : null}</div>
          : hint ? <KpiHintTip hint={hint} /> : null}
      </CardContent>
    </Card>
  );
}
