import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useSearchParams } from "react-router";
import { RefreshCw, Info, BarChart2, ArrowUpDown } from "lucide-react";
import { Navbar } from "~/components/layout/Navbar";
import { DataSourceFooter } from "~/components/DataSourceFooter";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { KpiCard } from "~/components/KpiCard";
import { formatPrice } from "~/lib/map-utils";
import type { Kabupaten } from "~/lib/map-utils";
import { db } from "~/lib/db";
import { checkL2, TTL } from "~/lib/cache";

const TrendChart = lazy(() => import("~/components/TrendChart"));

const API_URL =
  (typeof window !== "undefined" ? import.meta.env.VITE_API_URL : undefined) ??
  "http://localhost:8000/api";

interface Komoditas {
  id: string;
  nama: string;
  satuan: string;
  harga_acuan: number | null;
  slug: string;
}

interface SnapshotItem {
  periode_start: string;
  periode_end: string;
  periode_tahun: number;
  periode_nomor: number;
  harga: number | null;
  change_pct: number | null;
  is_locf: boolean;
  is_up: boolean | null;
}

type ChartPoint = Record<string, string | number | boolean | null>;
type Tipe = "weekly" | "monthly" | "quarterly" | "semesterly";

const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
const N_OPTIONS = [12, 24, 36, 48];

function periodLabel(tipe: Tipe, tahun: number, nomor: number): string {
  const yy = String(tahun).slice(2);
  if (tipe === "weekly") return `Mg${nomor} '${yy}`;
  if (tipe === "monthly") return `${BULAN[nomor - 1]} ${tahun}`;
  if (tipe === "quarterly") return `Q${nomor} ${tahun}`;
  return `S${nomor} ${tahun}`;
}

const TIPE_OPTIONS: { value: Tipe; label: string }[] = [
  { value: "weekly", label: "Mingguan" },
  { value: "monthly", label: "Bulanan" },
  { value: "quarterly", label: "Triwulan" },
  { value: "semesterly", label: "Semester" },
];

const SERIES_KABS: Kabupaten[] = [
  { kode: "pasar_modern", nama: "Pasar Modern (Ambon)" },
  { kode: "pasar_tradisional", nama: "Pasar Tradisional (Ambon)" },
];

const pasarModernCache = new Map<string, { modern: SnapshotItem[]; tradisional: SnapshotItem[] }>();

// Find SP2KP commodity whose slug is the longest prefix of the PIHPS slug
function matchTradisional(pihpsSlug: string, sp2kpList: Komoditas[]): Komoditas | null {
  return (
    sp2kpList
      .filter(k => pihpsSlug.startsWith(k.slug))
      .sort((a, b) => b.slug.length - a.slug.length)[0] ?? null
  );
}

function numberifyAnalisis(raw: Record<string, unknown>): SnapshotItem {
  return {
    periode_start: raw.periode_start as string,
    periode_end: raw.periode_end as string,
    periode_tahun: Number(raw.periode_tahun ?? 0),
    periode_nomor: Number(raw.periode_nomor ?? 0),
    harga: raw.harga != null ? Number(raw.harga) : null,
    change_pct: raw.change_pct != null ? Number(raw.change_pct) : null,
    is_locf: Boolean(raw.is_locf),
    is_up: raw.is_up != null ? Boolean(raw.is_up) : null,
  };
}

// SP2KP HargaSnapshotSerializer uses harga_lkv, not harga
function numberifySp2kp(raw: Record<string, unknown>): SnapshotItem {
  return {
    periode_start: raw.periode_start as string,
    periode_end: raw.periode_end as string,
    periode_tahun: Number(raw.periode_tahun ?? 0),
    periode_nomor: Number(raw.periode_nomor ?? 0),
    harga: raw.harga_lkv != null ? Number(raw.harga_lkv) : null,
    change_pct: raw.change_pct != null ? Number(raw.change_pct) : null,
    is_locf: Boolean(raw.is_locf),
    is_up: raw.is_up != null ? Boolean(raw.is_up) : null,
  };
}

function niceStep(range: number): number {
  const raw = range / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * pow;
}

function computeYAxis(
  prices: (number | null)[],
  hetHA: number | null,
): { yTicks: number[]; yDomain: [number, number] } {
  const valid = prices.filter((p): p is number => p != null);
  if (valid.length === 0) return { yTicks: [], yDomain: [0, 100] };
  const sorted = [...valid].sort((a, b) => a - b);
  const q5 = sorted[Math.max(0, Math.floor(sorted.length * 0.05))];
  const q95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95))];
  const rawMin = hetHA != null ? Math.min(q5, hetHA) : q5;
  const rawMax = hetHA != null ? Math.max(q95, hetHA) : q95;
  const range = rawMax - rawMin || rawMax * 0.2 || 1000;
  const step = niceStep(range * 1.2);
  const domainMin = Math.max(0, Math.floor(rawMin / step - 1) * step);
  const domainMax = Math.ceil(rawMax / step + 1) * step;
  const ticks: number[] = [];
  for (let t = domainMin; t <= domainMax; t += step) ticks.push(t);
  return { yTicks: ticks, yDomain: [domainMin, domainMax] };
}

export default function AnalisHargaPasarGrosir() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [pihpsSlug, setPihpsSlug] = useState<string | null>(() => searchParams.get("slug"));
  const [tipe, setTipe] = useState<Tipe>(
    () => (searchParams.get("tipe") as Tipe | null) ?? "weekly",
  );
  const [nPeriods, setNPeriods] = useState<number>(() => {
    const v = Number(searchParams.get("n"));
    return N_OPTIONS.includes(v) ? v : 24;
  });

  const [pihpsKoms, setPihpsKoms] = useState<Komoditas[]>([]);
  const [sp2kpKoms, setSp2kpKoms] = useState<Komoditas[]>([]);
  const [modernData, setModernData] = useState<SnapshotItem[]>([]);
  const [tradisionalData, setTradisionalData] = useState<SnapshotItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Sync URL params
  useEffect(() => {
    const p: Record<string, string> = { tipe, n: String(nPeriods) };
    if (pihpsSlug) p.slug = pihpsSlug;
    setSearchParams(p, { replace: true });
  }, [pihpsSlug, tipe, nPeriods, setSearchParams]);

  // Mount: parallel fetch both commodity lists
  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/komoditas/?sumber_id=2`).then(r => r.json()),
      fetch(`${API_URL}/komoditas/?sumber_id=1`).then(r => r.json()),
    ])
      .then(([pihps, sp2kp]: [Komoditas[], Komoditas[]]) => {
        setPihpsKoms(pihps);
        setSp2kpKoms(sp2kp);
      })
      .catch(console.error);
  }, []);

  const matchedSp2kp = useMemo(
    () => (pihpsSlug ? matchTradisional(pihpsSlug, sp2kpKoms) : null),
    [pihpsSlug, sp2kpKoms],
  );

  const mappedKoms = useMemo(
    () => pihpsKoms.filter(k => matchTradisional(k.slug, sp2kpKoms) != null),
    [pihpsKoms, sp2kpKoms],
  );

  // Auto-select first matched commodity when lists load
  useEffect(() => {
    if (pihpsSlug == null && mappedKoms.length > 0) {
      setPihpsSlug(mappedKoms[0].slug);
    }
  }, [mappedKoms, pihpsSlug]);

  // Data fetch — matchedSp2kp.id is a primitive string dep
  useEffect(() => {
    if (!pihpsSlug || !matchedSp2kp) {
      setModernData([]);
      setTradisionalData([]);
      return;
    }
    const key = `${pihpsSlug}:${matchedSp2kp.id}:${tipe}`;
    const cached = pasarModernCache.get(key);
    if (cached) {
      setModernData(cached.modern);
      setTradisionalData(cached.tradisional);
      return;
    }
    setIsLoading(true);
    (async () => {
      const l2 = await checkL2<{ modern: SnapshotItem[]; tradisional: SnapshotItem[] }>(
        () => db.snapshots.where("key").equals(key).first() as any,
        raw => JSON.parse(raw) as { modern: SnapshotItem[]; tradisional: SnapshotItem[] },
        TTL.SNAPSHOT,
      );

      if (l2) {
        pasarModernCache.set(key, l2.data);
        setModernData(l2.data.modern);
        setTradisionalData(l2.data.tradisional);
        if (l2.needsRefresh) {
          Promise.all([
            fetch(`${API_URL}/harga/analisis/snapshot/?slug=${pihpsSlug}&kabupaten=8171&tipe=${tipe}`).then(r => r.json()),
            fetch(`${API_URL}/harga/snapshot/?komoditas_id=${matchedSp2kp.id}&kabupaten=8171&tipe=${tipe}&tipe_pasar=1`).then(r => r.json()),
          ]).then(([analisisRaw, snapshotRaw]: [Record<string, unknown[]>, unknown[]]) => {
            const modern = (analisisRaw.pasar_modern ?? []).map(r => numberifyAnalisis(r as Record<string, unknown>));
            const tradisional = (Array.isArray(snapshotRaw) ? snapshotRaw : []).map(r => numberifySp2kp(r as Record<string, unknown>));
            pasarModernCache.set(key, { modern, tradisional });
            db.snapshots.put({ key, komoditas_id: Number(matchedSp2kp.id), kabupaten_kode: "8171", tipe, tipe_pasar: 1, data: JSON.stringify({ modern, tradisional }), cached_at: Date.now() });
          }).catch(() => {});
        }
        setIsLoading(false);
        return;
      }

      Promise.all([
        fetch(`${API_URL}/harga/analisis/snapshot/?slug=${pihpsSlug}&kabupaten=8171&tipe=${tipe}`).then(r => r.json()),
        fetch(`${API_URL}/harga/snapshot/?komoditas_id=${matchedSp2kp.id}&kabupaten=8171&tipe=${tipe}&tipe_pasar=1`).then(r => r.json()),
      ])
        .then(([analisisRaw, snapshotRaw]: [Record<string, unknown[]>, unknown[]]) => {
          const modern = (analisisRaw.pasar_modern ?? []).map(r => numberifyAnalisis(r as Record<string, unknown>));
          const tradisional = (Array.isArray(snapshotRaw) ? snapshotRaw : []).map(r => numberifySp2kp(r as Record<string, unknown>));
          pasarModernCache.set(key, { modern, tradisional });
          db.snapshots.put({ key, komoditas_id: Number(matchedSp2kp.id), kabupaten_kode: "8171", tipe, tipe_pasar: 1, data: JSON.stringify({ modern, tradisional }), cached_at: Date.now() });
          setModernData(modern);
          setTradisionalData(tradisional);
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    })();
  }, [pihpsSlug, matchedSp2kp?.id, tipe]);

  const chartData = useMemo<ChartPoint[]>(() => {
    const map = new Map<string, ChartPoint>();
    for (const item of modernData) {
      if (!map.has(item.periode_start)) map.set(item.periode_start, { label: periodLabel(tipe, item.periode_tahun, item.periode_nomor) });
      const pt = map.get(item.periode_start)!;
      if (item.harga != null) pt.pasar_modern = item.harga;
      pt.pasar_modern_locf = item.is_locf;
    }
    for (const item of tradisionalData) {
      if (!map.has(item.periode_start)) map.set(item.periode_start, { label: periodLabel(tipe, item.periode_tahun, item.periode_nomor) });
      const pt = map.get(item.periode_start)!;
      if (item.harga != null) pt.pasar_tradisional = item.harga;
      pt.pasar_tradisional_locf = item.is_locf;
    }
    const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([, pt]) => pt).slice(-nPeriods);
  }, [modernData, tradisionalData, tipe, nPeriods]);

  const activeSeries = useMemo(() => {
    const s: string[] = [];
    if (modernData.some(r => r.harga != null)) s.push("pasar_modern");
    if (tradisionalData.some(r => r.harga != null)) s.push("pasar_tradisional");
    return s;
  }, [modernData, tradisionalData]);

  const allPrices = useMemo(
    () => [...modernData.map(r => r.harga), ...tradisionalData.map(r => r.harga)],
    [modernData, tradisionalData],
  );

  const selectedKom = pihpsKoms.find(k => k.slug === pihpsSlug) ?? null;
  const hetHA = selectedKom?.harga_acuan ?? null;
  const { yTicks, yDomain } = useMemo(() => computeYAxis(allPrices, hetHA), [allPrices, hetHA]);

  const kpis = useMemo(() => {
    const pmLast = modernData.at(-1) ?? null;
    const trLast = tradisionalData.at(-1) ?? null;
    const gap =
      pmLast?.harga != null && trLast?.harga != null
        ? ((pmLast.harga - trLast.harga) / trLast.harga) * 100
        : null;
    const minMax = (items: SnapshotItem[]) =>
      items.reduce<{ min: number | null; max: number | null }>(
        (acc, r) => ({
          min:
            r.harga != null
              ? acc.min == null
                ? r.harga
                : Math.min(acc.min, r.harga)
              : acc.min,
          max:
            r.harga != null
              ? acc.max == null
                ? r.harga
                : Math.max(acc.max, r.harga)
              : acc.max,
        }),
        { min: null, max: null },
      );
    return { pmLast, trLast, gap, pm: minMax(modernData), tr: minMax(tradisionalData) };
  }, [modernData, tradisionalData]);

  const isEmpty = !isLoading && activeSeries.length === 0 && pihpsSlug != null;
  const hasData = chartData.length > 0;
  const rangeLabel = hasData
    ? `${chartData[0]?.label ?? "—"} → ${chartData[chartData.length - 1]?.label ?? "—"}`
    : null;

  const LINK_COLORS = ["#1456f0", "#16a34a"] as const;

  return (
    <main className="flex flex-col min-h-screen bg-surface">
      <Navbar />

      {/* ── Controls Bar ─────────────────────────────────────────── */}
      <div className="w-full border-b bg-card px-4 sm:px-7 py-4 space-y-3 shrink-0 overflow-x-auto">
        <div className="flex items-center justify-between min-w-max">
          <div className="flex items-center gap-1.5 text-xs text-steel">
            <span>Provinsi Maluku</span>
            <span className="opacity-40">›</span>
            <span className="text-ink font-semibold">Analisis Harga</span>
            <span className="opacity-40">›</span>
            <span>Pasar Modern vs Tradisional</span>
          </div>
          <div className="ml-8 flex items-center gap-3">
            <span className="text-xs font-mono text-steel">
              {isLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <RefreshCw className="h-3 w-3 animate-spin" />Memuat…
                </span>
              ) : rangeLabel ? (
                `${chartData.length} periode · ${rangeLabel}`
              ) : (
                "Pilih komoditas"
              )}
            </span>
          </div>
        </div>

        <div className="flex items-end gap-3 min-w-max">
          <div className="space-y-1.5 shrink-0 w-52">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Komoditas</label>
            <Select value={pihpsSlug ?? ""} onValueChange={v => setPihpsSlug(v)}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Pilih komoditas" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {mappedKoms.length === 0 ? (
                    <SelectItem value="__empty__" disabled>Komoditas belum tersedia</SelectItem>
                  ) : (
                    mappedKoms.map(k => (
                      <SelectItem key={k.slug} value={k.slug}>{k.nama}</SelectItem>
                    ))
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 shrink-0">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Tipe Periode</label>
            <div className="flex border rounded-md overflow-hidden h-9">
              {TIPE_OPTIONS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setTipe(opt.value)}
                  className={`px-3 text-xs font-medium transition-colors border-r last:border-r-0 ${
                    tipe === opt.value
                      ? "bg-[var(--brand-blue)] text-white"
                      : "bg-background text-steel hover:text-ink hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 shrink-0 w-32">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Tampilkan</label>
            <Select value={String(nPeriods)} onValueChange={v => setNPeriods(Number(v))}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {N_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{n} periode</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {matchedSp2kp && (
            <div className="space-y-1.5 shrink-0 self-end">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-muted border text-xs text-steel h-9">
                <span>dibandingkan dengan:</span>
                <span className="font-medium text-ink">{matchedSp2kp.nama}</span>
                <span className="text-steel/60">(SP2KP)</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Page body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Info note */}
        <div className="flex items-center gap-2 text-xs text-steel">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Data pasar modern hanya tersedia untuk Kota Ambon
        </div>

        {/* KPI row */}
        <section className="flex items-center gap-4 py-1 overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-pl-0">
          <KpiCard
            fixedHeight={true}
            label="Harga Pasar Modern"
            value={kpis.pmLast?.harga != null ? formatPrice(kpis.pmLast.harga) : "–"}
            hint={
              kpis.pmLast?.change_pct != null
                ? `${kpis.pmLast.change_pct > 0 ? "+" : ""}${kpis.pmLast.change_pct.toFixed(1)}%`
                : undefined
            }
            icon={<BarChart2 className="h-3.5 w-3.5" />}
            isLoading={isLoading}
          />
          <KpiCard
            fixedHeight={true}
            label="Harga Pasar Tradisional"
            value={kpis.trLast?.harga != null ? formatPrice(kpis.trLast.harga) : "–"}
            hint={
              kpis.trLast?.change_pct != null
                ? `${kpis.trLast.change_pct > 0 ? "+" : ""}${kpis.trLast.change_pct.toFixed(1)}%`
                : undefined
            }
            icon={<BarChart2 className="h-3.5 w-3.5" />}
            isLoading={isLoading}
          />
          <KpiCard
            fixedHeight={true}
            label="Selisih Harga"
            value={kpis.gap != null ? `${kpis.gap > 0 ? "+" : ""}${kpis.gap.toFixed(1)}%` : "–"}
            hint={
              kpis.gap != null
                ? kpis.gap > 0 ? "Modern lebih mahal"
                : kpis.gap < 0 ? "Modern lebih murah"
                : "Setara"
                : undefined
            }
            icon={<ArrowUpDown className="h-3.5 w-3.5" />}
            isLoading={isLoading}
          />
        </section>

        {/* Chart card */}
        <Card className="gap-0 py-3">
          <CardHeader className="py-0 px-4 pb-2 block">
            <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
              Perbandingan Harga
              {selectedKom && (
                <span className="font-normal text-steel text-xs">{selectedKom.nama}</span>
              )}
              {isLoading && <RefreshCw className="h-3 w-3 animate-spin text-steel ml-1" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            {isLoading ? (
              <div className="h-[340px] flex items-center justify-center">
                <RefreshCw className="h-5 w-5 animate-spin text-steel" />
              </div>
            ) : isEmpty ? (
              <div className="h-[340px] flex items-center justify-center rounded-xl border border-border bg-surface">
                <p className="text-sm text-steel text-center">
                  Data tidak tersedia untuk komoditas ini di Kota Ambon.
                </p>
              </div>
            ) : (
              <div className="relative">
                {isLoading && (
                  <div className="absolute inset-0 z-10 bg-background/60 flex items-center justify-center rounded-lg">
                    <RefreshCw className="h-4 w-4 animate-spin text-steel" />
                  </div>
                )}
                <Suspense
                  fallback={
                    <div className="h-[340px] flex items-center justify-center">
                      <RefreshCw className="h-5 w-5 animate-spin text-steel" />
                    </div>
                  }
                >
                  <TrendChart
                    chartData={chartData}
                    selectedKodes={activeSeries}
                    kabupatenList={SERIES_KABS}
                    hetHA={hetHA}
                    yTicks={yTicks}
                    yDomain={yDomain}
                  />
                </Suspense>
              </div>
            )}

            {/* Legend */}
            {activeSeries.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 pt-3 mt-1 border-t">
                {activeSeries.map((kode, idx) => {
                  const kab = SERIES_KABS.find(k => k.kode === kode);
                  const color = LINK_COLORS[idx % LINK_COLORS.length];
                  return (
                    <div key={kode} className="flex items-center gap-1.5 text-xs text-steel">
                      <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
                        <line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                      {kab ? kab.nama : kode}
                    </div>
                  );
                })}
                <div className="flex items-center gap-1.5 text-xs text-steel/70 ml-auto">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="4" fill="white" stroke="#94a3b8" strokeWidth="1.5" />
                  </svg>
                  Estimasi (LOCF)
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Comparison table */}
        {!isEmpty && !isLoading && activeSeries.length > 0 && (
          <Card className="gap-0 py-3">
            <CardHeader className="py-0 px-4 pb-2 block">
              <CardTitle className="text-sm">Ringkasan Perbandingan</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0 overflow-x-auto">
              <table className="w-full text-sm border-t">
                <thead>
                  <tr className="bg-muted/40">
                    {["Jenis Pasar", "Harga Terbaru", "Perubahan", "Terendah", "Tertinggi"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-steel whitespace-nowrap border-b">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([
                    { label: "Pasar Modern", last: kpis.pmLast, mm: kpis.pm, color: LINK_COLORS[0] },
                    { label: "Pasar Tradisional", last: kpis.trLast, mm: kpis.tr, color: LINK_COLORS[1] },
                  ] as const).map(({ label, last, mm, color }) => (
                    <tr key={label} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-ink whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          {label}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-ink tabular-nums text-xs">
                        {last?.harga != null ? formatPrice(last.harga) : "–"}
                      </td>
                      <td className={`px-4 py-2.5 font-medium tabular-nums text-xs ${
                        last?.change_pct == null ? "text-steel"
                          : last.change_pct < 0 ? "text-green-600"
                          : last.change_pct > 0 ? "text-red-500"
                          : "text-steel"
                      }`}>
                        {last?.change_pct != null
                          ? `${last.change_pct > 0 ? "+" : ""}${last.change_pct.toFixed(1)}%`
                          : "–"}
                      </td>
                      <td className="px-4 py-2.5 text-steel tabular-nums text-xs">
                        {mm.min != null ? formatPrice(mm.min) : "–"}
                      </td>
                      <td className="px-4 py-2.5 text-steel tabular-nums text-xs">
                        {mm.max != null ? formatPrice(mm.max) : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
      <DataSourceFooter sources={["sp2kp", "pihps"]} />
    </main>
  );
}
