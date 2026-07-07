import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useSearchParams } from "react-router";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  BarChart2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CheckCircle2,
} from "lucide-react";
import { Navbar } from "~/components/layout/Navbar";
import { DataSourceFooter } from "~/components/DataSourceFooter";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "~/components/ui/card";
import { KpiCard } from "~/components/KpiCard";
import { stripWilayahPrefix, type Kabupaten } from "~/lib/map-utils";
import { db } from "~/lib/db";
import { checkL2, TTL } from "~/lib/cache";
import { usePrefetch } from "~/hooks/usePrefetch";
import { buildAdjacentSnapshotUrls } from "~/lib/prefetch-utils";

const TrendChart = lazy(() => import("~/components/TrendChart"));

const API_URL =
  (typeof window !== "undefined" ? import.meta.env.VITE_API_URL : undefined) ??
  "http://localhost:8000/api";

const CITY_COLORS = ["#1456f0", "#16a34a", "#FB923C", "#8b5cf6", "#ec4899"] as const;
const HET_COLOR = "#f59e0b";

const TIPE_OPTIONS = [
  { value: "weekly", label: "Mingguan" },
  { value: "monthly", label: "Bulanan" },
  { value: "quarterly", label: "Kuartalan" },
  { value: "semesterly", label: "Semesteran" },
] as const;

const N_OPTIONS = [12, 24, 36, 48];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

type Tipe = "weekly" | "monthly" | "quarterly" | "semesterly";

interface Komoditas {
  id: string;
  nama: string;
  satuan: string;
  harga_acuan: number | null;
}

interface SnapshotRow {
  pangan_id: number;
  kabupaten: string;
  periode_tipe: Tipe;
  periode_tahun: number;
  periode_nomor: number;
  periode_start: string;
  periode_end: string;
  harga_lkv: number | null;
  is_locf: boolean;
  change_pct: number | null;
  is_up: boolean | null;
}

function periodLabel(row: SnapshotRow): string {
  const { periode_tipe: t, periode_tahun: y, periode_nomor: n } = row;
  if (t === "weekly") return `Mg${n} '${String(y).slice(2)}`;
  if (t === "monthly") return `${BULAN[n - 1]} ${y}`;
  if (t === "quarterly") return `Q${n} ${y}`;
  return `S${n} ${y}`;
}

function periodKey(row: SnapshotRow): string {
  return `${row.periode_tahun}-${String(row.periode_nomor).padStart(3, "0")}`;
}

function formatPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

// No thousand separator — used for chart tooltip and axis
function fmtChartPrice(v: number | null): string {
  if (v == null) return "—";
  return `Rp ${Math.round(v)}`;
}

function fmtYAxis(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}jt`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}rb`;
  return String(v);
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  if (n <= 1) return mag;
  if (n <= 2) return 2 * mag;
  if (n <= 5) return 5 * mag;
  return 10 * mag;
}

type ChartPoint = Record<string, string | number | boolean | null>;

const snapshotCache = new Map<string, SnapshotRow[]>();

const WHOLESALE_KODES = ["8171", "8172"];

const SOURCE_OPTIONS = [
  { value: 1, label: "Pasar Tradisional" },
  { value: 3, label: "Pedagang Besar" },
] as const;

export function meta() {
  return [
    { title: "Analisis Harga - Sistem Informasi Harga Komoditas" },
    { name: "description", content: "Analisis tren harga komoditas dari waktu ke waktu di Provinsi Maluku" },
  ];
}

export default function AnalisisHarga() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { schedule: prefetch } = usePrefetch();

  const [tipePasar, setTipePasar] = useState<1 | 3>(() => {
    const v = Number(searchParams.get("tipe_pasar"));
    return v === 3 ? 3 : 1;
  });
  const [komoditasId, setKomoditasId] = useState<string | null>(() => {
    const v = searchParams.get("komoditas_id");
    return v ?? null;
  });
  const [tipe, setTipe] = useState<Tipe>(() => {
    const v = searchParams.get("tipe") as Tipe | null;
    return TIPE_OPTIONS.some(o => o.value === v) ? (v as Tipe) : "weekly";
  });
  const [nPeriods, setNPeriods] = useState<number>(() => {
    const v = Number(searchParams.get("n"));
    return N_OPTIONS.includes(v) ? v : 24;
  });
  const [selectedKodes, setSelectedKodes] = useState<string[]>(() => {
    const v = searchParams.get("kota");
    if (v) return v.split(",").filter(Boolean);
    return [...WHOLESALE_KODES];
  });

  const [kabupatenList, setKabupatenList] = useState<Kabupaten[]>([]);
  const [komoditasList, setKomoditasList] = useState<Komoditas[]>([]);
  const kabMap = useMemo(
    () => new Map(kabupatenList.map(k => [k.kode, k])),
    [kabupatenList]
  );
  const [rawSnapshots, setRawSnapshots] = useState<Record<string, SnapshotRow[]>>({});
  const [isLoading, setIsLoading] = useState(false);

  // sync URL
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tipe_pasar", String(tipePasar));
    if (komoditasId != null) params.set("komoditas_id", komoditasId);
    params.set("tipe", tipe);
    params.set("n", String(nPeriods));
    if (selectedKodes.length) params.set("kota", selectedKodes.join(","));
    setSearchParams(params, { replace: true });
  }, [tipePasar, komoditasId, tipe, nPeriods, selectedKodes, setSearchParams]);

  // Initial kabupaten fetch (once)
  useEffect(() => {
    fetch(`${API_URL}/kabupaten/`).then(r => r.json()).then(setKabupatenList).catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload komoditas whenever source changes; reset dependent state
  useEffect(() => {
    const sumber = tipePasar === 3 ? 3 : 1;
    fetch(`${API_URL}/komoditas/?sumber_id=${sumber}`)
      .then(r => r.json())
      .then((koms: Komoditas[]) => {
        setKomoditasList(koms);
        setKomoditasId(koms.length > 0 ? koms[0].id : null);
        setSelectedKodes([...WHOLESALE_KODES]);
        setRawSnapshots({});
      })
      .catch(console.error);
  }, [tipePasar]); // eslint-disable-line react-hooks/exhaustive-deps

  const kodeDep = selectedKodes.join(",");
  useEffect(() => {
    if (komoditasId == null || selectedKodes.length === 0) {
      setRawSnapshots({});
      return;
    }
    setIsLoading(true);
    Promise.all(
      selectedKodes.map(kode =>
        (async () => {
          const cacheKey = `${komoditasId}:${kode}:${tipe}:${tipePasar}`;
          const cached = snapshotCache.get(cacheKey);
          if (cached) return [kode, cached] as const;

          const l2 = await checkL2<SnapshotRow[]>(
            () => db.snapshots.where("key").equals(cacheKey).first(),
            raw => JSON.parse(raw) as SnapshotRow[],
            TTL.SNAPSHOT,
          );

          if (l2) {
            snapshotCache.set(cacheKey, l2.data);
            if (l2.needsRefresh) {
              fetch(`${API_URL}/harga/snapshot/?komoditas_id=${komoditasId}&kabupaten=${kode}&tipe=${tipe}&tipe_pasar=${tipePasar}`)
                .then(r => r.json())
                .then((rows: any[]) => {
                  const parsed = rows.map((r: any) => ({
                    ...r,
                    harga_lkv: r.harga_lkv != null ? Number(r.harga_lkv) : null,
                    change_pct: r.change_pct != null ? Number(r.change_pct) : null,
                  }));
                  snapshotCache.set(cacheKey, parsed);
                  db.snapshots.put({ key: cacheKey, komoditas_id: komoditasId, kabupaten_kode: kode, tipe, tipe_pasar: tipePasar, data: JSON.stringify(parsed), cached_at: Date.now() });
                }).catch(() => {});
            }
            return [kode, l2.data] as const;
          }

          const rows: any[] = await fetch(`${API_URL}/harga/snapshot/?komoditas_id=${komoditasId}&kabupaten=${kode}&tipe=${tipe}&tipe_pasar=${tipePasar}`)
            .then(r => r.json());
          const parsed = rows.map((r: any) => ({
            ...r,
            harga_lkv: r.harga_lkv != null ? Number(r.harga_lkv) : null,
            change_pct: r.change_pct != null ? Number(r.change_pct) : null,
          }));
          snapshotCache.set(cacheKey, parsed);
          db.snapshots.put({ key: cacheKey, komoditas_id: komoditasId, kabupaten_kode: kode, tipe, tipe_pasar: tipePasar, data: JSON.stringify(parsed), cached_at: Date.now() });
          return [kode, parsed] as const;
        })()
      )
    )
      .then(entries => {
        const result: Record<string, SnapshotRow[]> = {};
        for (const [kode, rows] of entries) result[kode] = rows;
        setRawSnapshots(result);
        // Prefetch snapshots for each selected kabupaten
        if (komoditasId != null) {
          for (const kode of selectedKodes) {
            prefetch(buildAdjacentSnapshotUrls(komoditasId, kode, tipe, tipePasar, API_URL));
          }
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [komoditasId, tipe, kodeDep, tipePasar]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedKom = komoditasList.find(k => k.id === komoditasId) ?? null;
  const hetHA = selectedKom?.harga_acuan != null ? Number(selectedKom.harga_acuan) : null;

  // a) slice to nPeriods
  const displaySnapshots = useMemo(() => {
    const result: Record<string, SnapshotRow[]> = {};
    for (const [kode, rows] of Object.entries(rawSnapshots)) {
      result[kode] = rows.slice(-nPeriods);
    }
    return result;
  }, [rawSnapshots, nPeriods]);

  // b) unified time axis + chart data
  const { sortedKeys, labelByKey, chartData } = useMemo(() => {
    const allRows = Object.values(displaySnapshots).flat();
    const sortedKeys = Array.from(new Set(allRows.map(r => periodKey(r)))).sort();
    const labelByKey: Record<string, string> = {};
    for (const row of allRows) {
      const k = periodKey(row);
      if (!labelByKey[k]) labelByKey[k] = periodLabel(row);
    }
    const chartData: ChartPoint[] = sortedKeys.map(key => {
      const point: ChartPoint = { key, label: labelByKey[key] ?? key };
      for (const kode of selectedKodes) {
        const row = (displaySnapshots[kode] ?? []).find(r => periodKey(r) === key);
        point[kode] = row?.harga_lkv ?? null;
        point[`${kode}_locf`] = row?.is_locf ?? false;
      }
      return point;
    });
    return { sortedKeys, labelByKey, chartData };
  }, [displaySnapshots, selectedKodes]);

  // c) Y-axis: when HET/HA exists, build 7 explicit ticks with HET/HA at index 3 (exact center)
  const { allPricesFlat, yTicks, yDomain } = useMemo(() => {
    const allPricesFlat = chartData
      .flatMap(p => selectedKodes.map(k => p[k]))
      .filter((v): v is number => typeof v === "number" && v > 0);

    if (hetHA == null || allPricesFlat.length === 0) {
      return { allPricesFlat, yTicks: undefined, yDomain: undefined };
    }

    const sorted = [...allPricesFlat].sort((a, b) => a - b);
    const n = sorted.length;
    const quantile = (q: number) => sorted[Math.max(0, Math.min(n - 1, Math.round(q * (n - 1))))];
    const robustMin = n > 10 ? quantile(0.05) : sorted[0];
    const robustMax = n > 10 ? quantile(0.95) : sorted[n - 1];
    const armFromData = Math.max(Math.abs(robustMax - hetHA), Math.abs(hetHA - robustMin)) * 1.1;
    const minArm = hetHA * 0.08;
    const step = niceStep(Math.max(armFromData, minArm) / 3);
    const rawTicks = Array.from({ length: 7 }, (_, i) => hetHA + (i - 3) * step);
    let yTicks: number[] = rawTicks.map(v => Math.max(0, Math.round(v)));
    const uniqueTicks = [...new Set(yTicks)];
    if (uniqueTicks.length < yTicks.length) yTicks = uniqueTicks;
    const hardMin = sorted[0];
    const hardMax = sorted[n - 1];
    const domainMin = Math.max(0, Math.min(yTicks[0], Math.floor(hardMin * 0.97)));
    const domainMax = Math.max(yTicks[yTicks.length - 1], Math.ceil(hardMax * 1.03));
    return { allPricesFlat, yTicks, yDomain: [domainMin, domainMax] as [number, number] };
  }, [chartData, selectedKodes, hetHA]);

  // d) summary card metrics
  const { latestPrices, avgPrice, maxEntry, minEntry, ketimpangan, trendVotes, upCount, downCount, overallTrend, citiesWithData } = useMemo(() => {
    const latestKey = sortedKeys[sortedKeys.length - 1];
    const latestPrices: { kode: string; nama: string; price: number }[] = [];
    for (const kode of selectedKodes) {
      const row = (displaySnapshots[kode] ?? []).find(r => periodKey(r) === latestKey);
      const kab = kabMap.get(kode);
      if (row?.harga_lkv != null && kab)
        latestPrices.push({ kode, nama: stripWilayahPrefix(kab.nama).name, price: row.harga_lkv });
    }
    const avgPrice = latestPrices.length
      ? latestPrices.reduce((s, e) => s + e.price, 0) / latestPrices.length
      : null;
    const maxEntry = latestPrices.reduce<(typeof latestPrices)[0] | null>((m, e) => (!m || e.price > m.price ? e : m), null);
    const minEntry = latestPrices.reduce<(typeof latestPrices)[0] | null>((m, e) => (!m || e.price < m.price ? e : m), null);
    const ketimpangan = maxEntry && minEntry && maxEntry.kode !== minEntry.kode
      ? ((maxEntry.price - minEntry.price) / minEntry.price) * 100
      : null;
    const trendVotes = selectedKodes
      .map(kode => (displaySnapshots[kode] ?? []).find(r => periodKey(r) === latestKey)?.is_up ?? null)
      .filter((v): v is boolean => v !== null);
    const upCount = trendVotes.filter(v => v).length;
    const downCount = trendVotes.filter(v => !v).length;
    const overallTrend: "naik" | "turun" | "stabil" =
      upCount > downCount ? "naik" : downCount > upCount ? "turun" : "stabil";
    const citiesWithData = selectedKodes.filter(kode => (displaySnapshots[kode] ?? []).some(r => !r.is_locf)).length;
    return { latestPrices, avgPrice, maxEntry, minEntry, ketimpangan, trendVotes, upCount, downCount, overallTrend, citiesWithData };
  }, [displaySnapshots, selectedKodes, sortedKeys, kabMap]);

  // e) table rows
  const tableRows = useMemo(() => selectedKodes.map((kode, idx) => {
    const rows = displaySnapshots[kode] ?? [];
    const kab = kabMap.get(kode);
    const prices: number[] = [];
    let nonLocf = 0;
    for (const r of rows) {
      if (r.harga_lkv != null) prices.push(r.harga_lkv);
      if (!r.is_locf) nonLocf++;
    }
    const hargaAwal = rows[0]?.harga_lkv ?? null;
    const hargaAkhir = rows[rows.length - 1]?.harga_lkv ?? null;
    const perubahan = hargaAwal && hargaAkhir ? ((hargaAkhir - hargaAwal) / hargaAwal) * 100 : null;
    let min = prices.length ? prices[0] : null;
    let max = prices.length ? prices[0] : null;
    let sum = 0;
    for (const p of prices) {
      if (p < min!) min = p;
      if (p > max!) max = p;
      sum += p;
    }
    return {
      kode, idx,
      nama: kab ? stripWilayahPrefix(kab.nama).name : kode,
      hargaAwal, hargaAkhir, min, max,
      avg: prices.length ? sum / prices.length : null,
      perubahan,
      kelengkapan: rows.length ? (nonLocf / rows.length) * 100 : null,
    };
  }), [displaySnapshots, selectedKodes, kabMap]);

  function toggleKota(kode: string) {
    setSelectedKodes(prev => {
      if (prev.includes(kode)) return prev.filter(k => k !== kode);
      if (prev.length >= 5) return prev;
      return [...prev, kode];
    });
  }

  function handleExportCSV() {
    const headers = ["Kabupaten/Kota","Harga Awal","Harga Akhir","Minimum","Maksimum","Rata-rata","Perubahan (%)","Kelengkapan Data (%)"];
    const rows = tableRows.map(r => [
      r.nama, r.hargaAwal ?? "", r.hargaAkhir ?? "",
      r.min ?? "", r.max ?? "",
      r.avg != null ? r.avg.toFixed(0) : "",
      r.perubahan != null ? r.perubahan.toFixed(1) : "",
      r.kelengkapan != null ? r.kelengkapan.toFixed(0) : "",
    ]);
    const csv = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analisis-harga-${selectedKom?.nama ?? "komoditas"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasData = sortedKeys.length > 0;
  const isEmpty = selectedKodes.length === 0;
  const rangeLabel = sortedKeys.length > 0
    ? `${labelByKey[sortedKeys[0]] ?? "—"} → ${labelByKey[sortedKeys[sortedKeys.length - 1]] ?? "—"}`
    : null;

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
          </div>
          <div className="ml-8 flex items-center gap-3">
            {hetHA != null && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-xs font-medium text-amber-700">
                <span className="h-1.5 w-4 rounded-full opacity-80" style={{ background: `repeating-linear-gradient(90deg,${HET_COLOR} 0 4px,transparent 4px 7px)` }} />
                HET/HA {fmtChartPrice(hetHA)}
              </span>
            )}
            <span className="text-xs font-mono text-steel">
              {isLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <RefreshCw className="h-3 w-3 animate-spin" />Memuat…
                </span>
              ) : rangeLabel ? (
                `${sortedKeys.length} periode · ${rangeLabel}`
              ) : (
                "Pilih komoditas dan kota"
              )}
            </span>
          </div>
        </div>

        <div className="flex items-end gap-3 min-w-max">
          {/* Source switcher */}
          <div className="space-y-1.5 shrink-0">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Sumber Data</label>
            <div className="flex border rounded-md overflow-hidden h-9">
              {SOURCE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTipePasar(opt.value)}
                  className={`px-3 text-xs font-medium transition-colors border-r last:border-r-0 ${
                    tipePasar === opt.value
                      ? "bg-[var(--brand-blue)] text-white"
                      : "bg-background text-steel hover:text-ink hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 shrink-0 w-52">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Komoditas</label>
            <Select value={komoditasId ?? ""} onValueChange={v => setKomoditasId(v)}>
              <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Pilih komoditas" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {komoditasList.map(k => (
                    <SelectItem key={k.id} value={String(k.id)}>
                      {k.nama}{k.satuan ? ` · ${k.satuan}` : ""}
                    </SelectItem>
                  ))}
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

          {(selectedKodes.length > 0 || tipe !== "monthly" || nPeriods !== 24) && (
            <div className="space-y-1.5 shrink-0 self-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs text-steel hover:text-red-500 hover:bg-red-50 gap-1.5"
                onClick={() => {
                  setSelectedKodes([]);
                  setTipe("monthly");
                  setNPeriods(24);
                }}
              >
                <RefreshCw className="h-3 w-3" />
                Reset
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Page body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Summary Cards */}
        {!isEmpty && (
          <section className="flex items-center gap-4 py-1 overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-pl-0">
            <KpiCard
              className="w-52"
              fixedHeight={true}
              label="Rata-rata Harga"
              value={fmtChartPrice(avgPrice != null ? Math.round(avgPrice) : null)}
              hint={hetHA != null && avgPrice != null
                ? `${avgPrice > hetHA ? "+" : ""}${((avgPrice - hetHA) / hetHA * 100).toFixed(1)}% dari HET/HA`
                : undefined}
              definition="Rata-rata harga terbaru dari seluruh kota yang dipilih."
              icon={<BarChart2 className="h-3.5 w-3.5" />}
              isLoading={isLoading}
            />
            <KpiCard
              className="w-52"
              fixedHeight={true}
              label="Tren Keseluruhan"
              value={trendVotes.length === 0 ? "—"
                : overallTrend === "naik" ? "Naik ↑"
                : overallTrend === "turun" ? "Turun ↓"
                : "Stabil →"}
              valueClass={trendVotes.length === 0 ? "" : overallTrend === "naik" ? "text-red-500" : overallTrend === "turun" ? "text-emerald-600" : "text-slate-400"}
              hint={`${upCount} naik · ${downCount} turun dari ${trendVotes.length} kota`}
              definition="Arah harga terbaru mayoritas kota terpilih dibanding periode sebelumnya."
              icon={overallTrend === "naik" ? <TrendingUp className="h-3.5 w-3.5" /> : overallTrend === "turun" ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
              isLoading={isLoading}
            />
            <KpiCard
              className="w-52"
              fixedHeight={true}
              label="Harga Tertinggi"
              value={fmtChartPrice(maxEntry?.price ?? null)}
              hint={maxEntry?.nama}
              definition="Kota dengan harga terbaru tertinggi di antara kota yang dipilih."
              icon={<ArrowUp className="h-3.5 w-3.5" />}
              valueClass="text-red-500"
              isLoading={isLoading}
            />
            <KpiCard
              className="w-52"
              fixedHeight={true}
              label="Harga Terendah"
              value={fmtChartPrice(minEntry?.price ?? null)}
              hint={minEntry?.nama}
              definition="Kota dengan harga terbaru terendah di antara kota yang dipilih."
              icon={<ArrowDown className="h-3.5 w-3.5" />}
              valueClass="text-emerald-600"
              isLoading={isLoading}
            />
            <KpiCard
              className="w-52"
              fixedHeight={true}
              label="Ketimpangan"
              value={ketimpangan != null ? `${ketimpangan.toFixed(1)}%` : "—"}
              hint={maxEntry && minEntry && maxEntry.kode !== minEntry.kode
                ? `${maxEntry.nama} vs ${minEntry.nama}`
                : undefined}
              definition="Selisih relatif antara harga tertinggi dan terendah — indikator disparitas antar kota."
              icon={<ArrowUpDown className="h-3.5 w-3.5" />}
              isLoading={isLoading}
            />
            <KpiCard
              className="w-52"
              fixedHeight={true}
              label="Cakupan Data"
              value={selectedKodes.length > 0 ? `${citiesWithData}/${selectedKodes.length}` : "—"}
              hint="kota memiliki data nyata"
              definition="Jumlah kota terpilih yang memiliki setidaknya satu data harga nyata (bukan estimasi LOCF) dalam rentang periode ini."
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              isLoading={isLoading}
            />
          </section>
        )}

        {/* City Picker + Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-[196px_1fr] gap-4">

          {/* City Picker */}
          <Card className="gap-0 py-3">
            <CardHeader className="py-0 px-4 pb-2 block">
              <CardTitle className="text-sm">Pilih Kota</CardTitle>
              <p className="text-xs text-steel mt-0.5">
                <span className="font-semibold text-ink">{selectedKodes.length}</span>/5 dipilih
              </p>
              {tipePasar === 3 && (
                <p className="text-xs text-amber-600 mt-1">Data tersedia untuk Kota Ambon dan Kota Tual saja.</p>
              )}
            </CardHeader>
            <CardContent className="px-3 pb-2 space-y-0.5">
              {(() => {
                const visibleList = tipePasar === 3
                  ? kabupatenList.filter(k => WHOLESALE_KODES.includes(k.kode))
                  : kabupatenList;
                return visibleList.length === 0
                  ? Array.from({ length: tipePasar === 3 ? 2 : 11 }).map((_, i) => (
                      <div key={i} className="h-8 bg-muted animate-pulse rounded-md mb-1" />
                    ))
                  : visibleList.map(kab => {
                    const idx = selectedKodes.indexOf(kab.kode);
                    const selected = idx !== -1;
                    const color = selected ? CITY_COLORS[idx % CITY_COLORS.length] : undefined;
                    const atMax = !selected && selectedKodes.length >= 5;
                    return (
                      <button
                        key={kab.kode}
                        type="button"
                        onClick={() => toggleKota(kab.kode)}
                        disabled={atMax}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left ${
                          selected
                            ? "bg-muted font-medium text-ink"
                            : atMax
                              ? "text-steel/30 cursor-not-allowed"
                              : "text-steel hover:text-ink hover:bg-muted/60"
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0 border transition-all"
                          style={color
                            ? { backgroundColor: color, borderColor: color }
                            : { borderColor: "#d1d5db" }}
                        />
                        <span className="truncate flex-1">{stripWilayahPrefix(kab.nama).name}</span>
                        {selected && (
                          <span className="text-xs text-steel font-normal shrink-0">#{idx + 1}</span>
                        )}
                      </button>
                    );
                  });
              })()}
              {selectedKodes.length >= 5 && (
                <p className="text-xs text-center text-steel/60 pt-1 pb-0.5">Maks. 5 kota</p>
              )}
            </CardContent>
          </Card>

          {/* Chart */}
          <Card className="gap-0 py-3">
            <CardHeader className="py-0 px-4 pb-2 block">
              <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                Tren Harga
                {selectedKom && (
                  <span className="font-normal text-xs">
                    <span className="font-semibold text-[var(--brand-blue)]">{selectedKom.nama}</span>
                    {selectedKom.satuan && <span className="text-steel"> · {selectedKom.satuan}</span>}
                  </span>
                )}
                {isLoading && <RefreshCw className="h-3 w-3 animate-spin text-steel ml-1" />}
              </CardTitle>
            </CardHeader>

            <CardContent className="px-2 pb-3">
              {/* Chart area */}
              {isEmpty ? (
                <div className="h-[340px] flex flex-col items-center justify-center gap-2 text-center px-6">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-steel/50" />
                  </div>
                  <p className="text-sm font-medium text-ink">Pilih kota untuk memulai</p>
                  <p className="text-xs text-steel">Klik nama kota di panel kiri — maksimal 5 kota sekaligus.</p>
                </div>
              ) : !hasData && !isLoading ? (
                <div className="h-[340px] flex items-center justify-center text-sm text-steel">
                  Tidak ada data untuk filter yang dipilih.
                </div>
              ) : isLoading && !hasData ? (
                <div className="h-[340px] flex items-center justify-center">
                  <RefreshCw className="h-5 w-5 animate-spin text-steel" />
                </div>
              ) : (
                <div className="relative">
                  {isLoading && (
                    <div className="absolute inset-0 z-10 bg-background/60 flex items-center justify-center rounded-lg">
                      <RefreshCw className="h-4 w-4 animate-spin text-steel" />
                    </div>
                  )}
                  <Suspense fallback={<div className="h-[340px] flex items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-steel" /></div>}>
                    <TrendChart
                      chartData={chartData}
                      selectedKodes={selectedKodes}
                      kabupatenList={kabupatenList}
                      hetHA={hetHA}
                      yTicks={yTicks}
                      yDomain={yDomain}
                    />
                  </Suspense>
                </div>
              )}

              {/* ── Legend ──────────────────────────────────────── */}
              {(selectedKodes.length > 0 || hetHA != null) && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 pt-3 mt-1 border-t">
                  {/* City lines */}
                  {selectedKodes.map((kode, idx) => {
                    const kab = kabMap.get(kode);
                    const color = CITY_COLORS[idx % CITY_COLORS.length];
                    return (
                      <div key={kode} className="flex items-center gap-1.5 text-xs text-steel">
                        <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
                          <line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                        {kab ? stripWilayahPrefix(kab.nama).name : kode}
                      </div>
                    );
                  })}

                  {/* HET/HA */}
                  {hetHA != null && (
                    <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: HET_COLOR }}>
                      <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
                        <line x1="0" y1="5" x2="20" y2="5" stroke={HET_COLOR} strokeWidth="1.5" strokeDasharray="5 3" />
                      </svg>
                      HET/HA
                    </div>
                  )}

                  {/* LOCF */}
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
        </div>

        {/* ── Summary Table ──────────────────────────────────────── */}
        {tableRows.length > 0 && (
          <Card className="gap-0 py-3">
            <CardHeader className="py-0 px-4 pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">Ringkasan per Kota</CardTitle>
                {rangeLabel && (
                  <p className="text-xs text-steel mt-0.5">{rangeLabel}</p>
                )}
              </div>
              <CardAction>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExportCSV}>
                  <Download className="h-3 w-3" />Unduh CSV
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="px-0 pb-0 overflow-x-auto">
              <table className="w-full text-sm border-t">
                <thead>
                  <tr className="bg-muted/40">
                    {["Kabupaten/Kota", "Harga Awal", "Harga Akhir", "Min", "Maks", "Rata-rata", "Perubahan", "Kelengkapan"].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-steel whitespace-nowrap border-b">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, i) => (
                    <tr key={row.kode} className={`transition-colors hover:bg-muted/30 ${i % 2 !== 0 ? "bg-muted/10" : ""}`}>
                      <td className="px-4 py-2.5 font-medium text-ink whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: CITY_COLORS[row.idx % CITY_COLORS.length] }}
                          />
                          {row.nama}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-steel tabular-nums text-xs">{fmtChartPrice(row.hargaAwal)}</td>
                      <td className="px-4 py-2.5 font-medium text-ink tabular-nums text-xs">{fmtChartPrice(row.hargaAkhir)}</td>
                      <td className="px-4 py-2.5 text-steel tabular-nums text-xs">{fmtChartPrice(row.min)}</td>
                      <td className="px-4 py-2.5 text-steel tabular-nums text-xs">{fmtChartPrice(row.max)}</td>
                      <td className="px-4 py-2.5 text-steel tabular-nums text-xs">
                        {row.avg != null ? fmtChartPrice(Math.round(row.avg)) : "—"}
                      </td>
                      <td className={`px-4 py-2.5 font-medium tabular-nums text-xs ${
                        row.perubahan == null ? "text-steel"
                          : row.perubahan < 0 ? "text-green-600"
                          : row.perubahan > 0 ? "text-red-500"
                          : "text-steel"
                      }`}>
                        <span className="inline-flex items-center gap-0.5">
                          {row.perubahan != null && row.perubahan > 0 && <ArrowUpRight className="h-3 w-3" />}
                          {row.perubahan != null && row.perubahan < 0 && <ArrowDownRight className="h-3 w-3" />}
                          {formatPct(row.perubahan)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-steel text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--brand-blue)]"
                              style={{ width: `${row.kelengkapan ?? 0}%` }}
                            />
                          </div>
                          {row.kelengkapan != null ? `${row.kelengkapan.toFixed(0)}%` : "—"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <div className="h-14 w-14 rounded-full bg-background border flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-[var(--brand-blue)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink">Analisis tren harga komoditas</p>
              <p className="text-xs text-steel mt-1">Pilih komoditas di atas, lalu klik kota untuk membandingkan hingga 5 wilayah.</p>
            </div>
          </div>
        )}
      </div>
      <DataSourceFooter sources={tipePasar === 1 ? ["sp2kp"] : ["pihps"]} />
    </main>
  );
}
