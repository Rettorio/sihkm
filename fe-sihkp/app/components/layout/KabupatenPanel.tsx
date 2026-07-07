import { useState, useRef } from "react";
import { Search, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import {
  formatPrice,
  getChoroChangeColor,
  stripWilayahPrefix,
  type Kabupaten,
  type PriceEntry,
} from "~/lib/map-utils";

type SortMode = "harga-tertinggi" | "harga-terendah" | "a-z" | "z-a";

interface KabupatenPanelProps {
  kabupatenList: Kabupaten[];
  priceByKab: Record<string, PriceEntry>;
  selectedKabupaten: string;
  onKabupatenClick: (kode: string) => void;
  compareMode: boolean;
  compareA: string;
  compareB: string;
  onCompareClear: (slot: "a" | "b") => void;
  isLoading?: boolean;
  hoveredKabupaten?: string | null;
  onKabupatenHover?: (kode: string | null) => void;
  hoverSyncEnabled?: boolean;
  onToggleHoverSync?: () => void;
  onResetMap?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

function sortKabupaten(
  list: Kabupaten[],
  priceByKab: Record<string, PriceEntry>,
  sortBy: SortMode,
): Kabupaten[] {
  return [...list].sort((a, b) => {
    const aData = priceByKab[a.kode]?.harga != null;
    const bData = priceByKab[b.kode]?.harga != null;
    if (aData && !bData) return -1;
    if (!aData && bData) return 1;

    const aPrice = priceByKab[a.kode]?.harga ?? 0;
    const bPrice = priceByKab[b.kode]?.harga ?? 0;

    switch (sortBy) {
      case "harga-tertinggi": return bPrice - aPrice;
      case "harga-terendah":  return aPrice - bPrice;
      case "a-z":             return a.nama.localeCompare(b.nama);
      case "z-a":             return b.nama.localeCompare(a.nama);
    }
  });
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "harga-tertinggi", label: "Harga Tertinggi" },
  { value: "harga-terendah",  label: "Harga Terendah" },
  { value: "a-z",             label: "A\u2013Z" },
  { value: "z-a",             label: "Z\u2013A" },
];

export function KabupatenPanel({
  kabupatenList, priceByKab, selectedKabupaten,
  onKabupatenClick, compareMode, compareA, compareB, onCompareClear, isLoading = false,
  hoveredKabupaten, onKabupatenHover, hoverSyncEnabled = true, onToggleHoverSync, onResetMap, onZoomIn, onZoomOut,
}: KabupatenPanelProps) {
  const [kabSearch, setKabSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>("harga-tertinggi");
  const gridRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const buttons = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const idx = buttons.indexOf(e.currentTarget);
    if (idx === -1) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      buttons[(idx + 1) % buttons.length]?.focus();
    } else {
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    }
  }

  const kabNameByKode = (kode: string) =>
    kabupatenList.find(k => k.kode === kode)?.nama ?? "";

  const filteredKabupaten = kabSearch
    ? kabupatenList.filter(k =>
        stripWilayahPrefix(k.nama).name.toLowerCase().includes(kabSearch.toLowerCase()),
      )
    : kabupatenList;

  const sortedKabupaten = sortKabupaten(filteredKabupaten, priceByKab, sortBy);

  return (
    <Card
      className="gap-0 py-4"
      onKeyDown={(e) => {
        if (!e.ctrlKey) return;
        if (e.key === "r") { e.preventDefault(); onResetMap?.(); }
        else if (e.key === "+" || e.key === "=") { e.preventDefault(); onZoomIn?.(); }
        else if (e.key === "-") { e.preventDefault(); onZoomOut?.(); }
      }}
    >
      <CardHeader className="py-3 px-4">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0" />
            {compareMode ? "Pilih Dua Kabupaten/Kota" : "Kabupaten / Kota"}
          </span>
          {!compareMode && onToggleHoverSync && (
            <label className="flex items-center gap-1.5 text-[11px] font-normal text-steel cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hoverSyncEnabled}
                onChange={onToggleHoverSync}
                className="h-3 w-3 accent-(--brand-blue)"
              />
              Sinkron peta
            </label>
          )}
        </CardTitle>
      </CardHeader>
      {compareMode ? (
        <CardContent className="max-h-100 lg:max-h-120 overflow-y-auto p-3 flex flex-col gap-3">
          <ComparisonSlot
            label="A"
            kode={compareA}
            nama={kabNameByKode(compareA)}
            price={priceByKab[compareA]?.harga ?? null}
            onClear={() => onCompareClear("a")}
          />
          <ComparisonSlot
            label="B"
            kode={compareB}
            nama={kabNameByKode(compareB)}
            price={priceByKab[compareB]?.harga ?? null}
            onClear={() => onCompareClear("b")}
          />
          <p className="text-xs text-steel pt-1">
            Klik wilayah pada peta atau daftar di bawah untuk mengisi slot kosong.
          </p>
          <div className="flex flex-col gap-1 pt-1">
            {sortedKabupaten.map(kab => {
              const isSelected = compareA === kab.kode || compareB === kab.kode;
              return (
                <button
                  key={kab.kode}
                  onClick={() => onKabupatenClick(kab.kode)}
                  disabled={isSelected}
                  className={cn(
                    "w-full px-3 py-2 text-left rounded-md border border-hairline text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    isSelected
                      ? "bg-muted text-steel cursor-default"
                      : "hover:bg-muted text-ink",
                  )}
                >
                  {kab.nama}
                </button>
              );
            })}
          </div>
        </CardContent>
      ) : (
        <CardContent className="max-h-[400px] lg:max-h-[480px] overflow-y-auto p-3">
          {selectedKabupaten && (
            <button
              type="button"
              onClick={() => onKabupatenClick(selectedKabupaten)}
              className="w-full mb-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted border border-ink/20 text-xs font-medium text-ink hover:bg-muted/70 transition-colors"
            >
              <span className="text-steel">←</span>
              Lihat Semua Wilayah
            </button>
          )}
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-steel pointer-events-none" />
              <input
                type="search"
                aria-label="Cari kabupaten/kota"
                value={kabSearch}
                onChange={e => setKabSearch(e.target.value)}
                placeholder="Cari kabupaten/kota..."
                className="w-full h-9 pl-8 pr-3 rounded-md border border-input bg-background text-sm text-ink placeholder:text-steel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortMode)}
              aria-label="Urutkan wilayah"
              className="h-9 rounded-md border border-input bg-background px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div ref={gridRef} className="grid grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-1.5">
            {isLoading && Object.keys(priceByKab).length === 0 ? (
              Array.from({ length: 11 }).map((_, i) => (
                <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
              ))
            ) : sortedKabupaten.length === 0 ? (
              <p className="col-span-2 lg:col-span-1 xl:col-span-2 text-sm text-steel text-center py-6">Tidak ada hasil</p>
            ) : sortedKabupaten.map(kab => {
              const entry = priceByKab[kab.kode];
              const { name, type } = stripWilayahPrefix(kab.nama);
              const isActive = selectedKabupaten === kab.kode;
              const isHovered = hoveredKabupaten === kab.kode;
              const noData = entry?.harga == null;
              const dotColor = getChoroChangeColor(entry?.change_pct ?? null);

              return (
                <button
                  key={kab.kode}
                  onClick={() => onKabupatenClick(kab.kode)}
                  onMouseEnter={() => onKabupatenHover?.(kab.kode)}
                  onMouseLeave={() => onKabupatenHover?.(null)}
                  onFocus={() => onKabupatenHover?.(kab.kode)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => onKabupatenHover?.(null)}
                  className={cn(
                    "w-full px-4 py-3 text-left rounded-md border transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 flex items-center gap-3",
                    isActive
                      ? "border-[3px] border-ink bg-muted shadow-sm"
                      : isHovered
                        ? "border-[3px] border-dashed border-ink"
                        : "border border-hairline",
                  )}
                >
                  <div
                    className="w-1 shrink-0 self-stretch rounded-full"
                    style={{ background: dotColor }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className={cn(
                        "text-sm text-ink leading-tight wrap-break-word transition-all duration-100",
                        isActive ? "font-bold" : "font-semibold",
                      )}>
                        {name}
                      </div>
                      {type && (
                        <Badge variant="outline" className="text-[10px] leading-none px-1.5 py-0 h-4 shrink-0">
                          {type}
                        </Badge>
                      )}
                    </div>
                    <div className={cn(
                      "text-xs mt-0.5 tabular-nums",
                      noData ? "text-steel italic" : "text-steel",
                    )}>
                      {noData ? "Data tidak tersedia" : formatPrice(entry?.harga)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function ComparisonSlot({
  label, kode, nama, price, onClear,
}: {
  label: string;
  kode: string;
  nama: string;
  price: number | null;
  onClear: () => void;
}) {
  return (
    <div className={cn(
      "rounded-lg border p-3",
      kode ? "border-ink bg-muted" : "border-dashed border-hairline",
    )}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-steel">
          Wilayah {label}
        </span>
        {kode && (
          <button
            onClick={onClear}
            className="text-xs text-steel hover:text-ink focus-visible:outline-none focus-visible:underline"
          >
            Hapus
          </button>
        )}
      </div>
      {kode ? (
        <>
          <div className="font-semibold text-sm text-ink">{nama}</div>
          <div className="text-xs text-steel tabular-nums mt-0.5">
            {price != null ? formatPrice(price) : "Data tidak tersedia"}
          </div>
        </>
      ) : (
        <div className="text-sm text-steel">Belum dipilih</div>
      )}
    </div>
  );
}
