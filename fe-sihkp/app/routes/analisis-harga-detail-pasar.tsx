import type { Route } from "./+types/analisis-harga-detail-pasar";
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useSearchParams, useLoaderData } from "react-router";
import { RefreshCw } from "lucide-react";
import { Navbar } from "~/components/layout/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatPrice } from "~/lib/map-utils";
import type { Kabupaten } from "~/lib/map-utils";
import { db } from "~/lib/db";
import { TTL } from "~/lib/cache";
import { DataSourceFooter } from "~/components/DataSourceFooter";

const TrendChart = lazy(() => import("~/components/TrendChart"));

const API_URL =
  (typeof window !== "undefined" ? import.meta.env.VITE_API_URL : undefined) ??
  "http://localhost:8000/api";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const KAB_OPTIONS = [
  { kode: "8171" as const, label: "Kota Ambon" },
  { kode: "8172" as const, label: "Kota Tual" },
];

type KabKode = "8171" | "8172";

const COMMODITY_GROUPS = [
  { key: "beras",       label: "Beras",         match: (n: string) => /^beras/i.test(n.trim()) },
  { key: "daging-ayam", label: "Daging Ayam",   match: (n: string) => /daging.*ayam/i.test(n) },
  { key: "daging-sapi", label: "Daging Sapi",   match: (n: string) => /daging.*sapi|sapi/i.test(n) },
  { key: "telur",       label: "Telur Ayam",    match: (n: string) => /telur/i.test(n) },
  { key: "bawang",      label: "Bawang",        match: (n: string) => /^bawang/i.test(n.trim()) },
  { key: "cabai-merah", label: "Cabai Merah",   match: (n: string) => /cabai merah/i.test(n) },
  { key: "cabai-rawit", label: "Cabai Rawit",   match: (n: string) => /cabai rawit/i.test(n) },
  { key: "minyak",      label: "Minyak Goreng", match: (n: string) => /minyak/i.test(n) },
  { key: "gula",        label: "Gula Pasir",    match: (n: string) => /gula/i.test(n) },
];

type Tipe = "weekly" | "monthly";

const TIPE_OPTIONS: { value: Tipe; label: string }[] = [
  { value: "weekly",  label: "Mingguan" },
  { value: "monthly", label: "Bulanan" },
];

const N_OPTIONS = [12, 24, 36, 48];

// Must stay in sync with TrendChart's CITY_COLORS
const LINE_COLORS = ["#1456f0", "#16a34a", "#FB923C", "#8b5cf6", "#ec4899", "#06b6d4", "#a16207", "#dc2626"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Komoditas {
  id: string;
  nama: string;
  satuan: string;
  harga_acuan: number | null;
  slug: string;
}

interface WholesalePoint {
  date?: string;
  periode_start?: string;
  periode_end?: string;
  periode_tahun?: number;
  periode_nomor?: number;
  harga: number | null;
}

interface WholesaleResponse {
  komoditas: { slug: string; nama: string };
  kabupaten: { kode: string };
  regency_avg: WholesalePoint[];
  markets: { id: number; nama: string; series: WholesalePoint[] }[];
}

type ChartPoint = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------------------
// Loader (SSR) — komoditas list rendered on first paint
// ---------------------------------------------------------------------------

export async function loader(_: Route.LoaderArgs) {
  const api = process.env.SERVER_API_URL ?? "http://localhost:8000/api";
  try {
    const komoditasList: Komoditas[] = await fetch(`${api}/komoditas/?sumber_id=2`).then(r => r.json());
    return { komoditasList };
  } catch {
    return { komoditasList: [] as Komoditas[] };
  }
}

// ---------------------------------------------------------------------------
// L1 in-memory cache + L2 IDB helpers
// ---------------------------------------------------------------------------

const slugCache = new Map<string, WholesaleResponse>();

async function fetchSlug(slug: string, kab: string, tipe: string): Promise<WholesaleResponse> {
  const cKey = `${slug}:${kab}:${tipe}`;

  // L1 hit
  if (slugCache.has(cKey)) return slugCache.get(cKey)!;

  // L2 hit (IDB)
  try {
    const row = await db.wholesale_cache.where("key").equals(cKey).first();
    if (row && Date.now() - row.cached_at < TTL.WHOLESALE) {
      const data = JSON.parse(row.data) as WholesaleResponse;
      slugCache.set(cKey, data);
      return data;
    }
  } catch { /* IDB unavailable — fall through to network */ }

  // Network
  const url = `${API_URL}/harga/wholesale/side-by-side/?komoditas_slug=${slug}&kabupaten=${kab}&tipe=${tipe}`;
  const data: WholesaleResponse = await fetch(url).then(r => r.json());
  slugCache.set(cKey, data);
  // Write to IDB (fire-and-forget)
  db.wholesale_cache.where("key").equals(cKey).delete()
    .then(() => db.wholesale_cache.add({ key: cKey, data: JSON.stringify(data), cached_at: Date.now() }))
    .catch(() => { /* non-fatal */ });
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];

function periodLabel(tipe: Tipe, tahun: number, nomor: number): string {
  const yy = String(tahun).slice(2);
  if (tipe === "weekly")  return `Mg${nomor} '${yy}`;
  if (tipe === "monthly") return `${BULAN[nomor - 1]} ${tahun}`;
  return `${nomor}/${yy}`;
}

function pointKey(pt: WholesalePoint): string {
  return pt.date ?? pt.periode_start ?? "";
}

function pointLabel(pt: WholesalePoint, tipe: Tipe): string {
  if (pt.periode_tahun != null && pt.periode_nomor != null) {
    return periodLabel(tipe, pt.periode_tahun, pt.periode_nomor);
  }
  return pt.periode_start ?? pt.date ?? "";
}

function niceStep(range: number): number {
  const raw = range / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * pow;
}

function computeYAxis(prices: (number | null)[]): { yTicks: number[]; yDomain: [number, number] } {
  const valid = prices.filter((p): p is number => p != null);
  if (valid.length === 0) return { yTicks: [], yDomain: [0, 100] };
  const sorted = [...valid].sort((a, b) => a - b);
  const q5  = sorted[Math.max(0, Math.floor(sorted.length * 0.05))];
  const q95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95))];
  const range = q95 - q5 || q95 * 0.2 || 1000;
  const step = niceStep(range * 1.2);
  const domainMin = Math.max(0, Math.floor(q5 / step - 1) * step);
  const domainMax = Math.ceil(q95 / step + 1) * step;
  const ticks: number[] = [];
  for (let t = domainMin; t <= domainMax; t += step) ticks.push(t);
  return { yTicks: ticks, yDomain: [domainMin, domainMax] };
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function meta() {
  return [
    { title: "Analisis Pasar Grosir - Sistem Informasi Harga Komoditas" },
    { name: "description", content: "Perbandingan harga pedagang besar Kota Ambon dan Kota Tual" },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AnalisHargaDetailPasar() {
  const { komoditasList } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedGroup, setSelectedGroup] = useState<string>(
    () => searchParams.get("group") ?? "beras",
  );
  const [kab, setKab] = useState<KabKode>(
    () => (searchParams.get("kab") as KabKode | null) ?? "8171",
  );
  const [tipe, setTipe] = useState<Tipe>(
    () => (searchParams.get("tipe") as Tipe | null) ?? "weekly",
  );
  const [nPeriods, setNPeriods] = useState<number>(() => {
    const v = Number(searchParams.get("n"));
    return N_OPTIONS.includes(v) ? v : 24;
  });

  const [groupDataMap, setGroupDataMap] = useState<Map<string, WholesaleResponse>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // URL sync
  useEffect(() => {
    setSearchParams(
      { group: selectedGroup, kab, tipe, n: String(nPeriods) },
      { replace: true },
    );
  }, [selectedGroup, kab, tipe, nPeriods, setSearchParams]);

  // Fetch all variants for selected group + kab + tipe
  useEffect(() => {
    const group = COMMODITY_GROUPS.find(g => g.key === selectedGroup);
    if (!group || komoditasList.length === 0) return;
    const variants = komoditasList.filter((k: Komoditas) => group.match(k.nama));
    if (variants.length === 0) return;

    // All variants already in L1 → instant swap, no loading flash
    const allL1 = variants.every((k: Komoditas) => slugCache.has(`${k.slug}:${kab}:${tipe}`));
    if (allL1) {
      setGroupDataMap(new Map(variants.map((k: Komoditas) => [k.slug, slugCache.get(`${k.slug}:${kab}:${tipe}`)!])));
      return;
    }

    // Partial or uncached — keep old chart visible, show spinner in header only
    setIsLoading(true);

    Promise.all(variants.map(async (kom: Komoditas) => {
      const data = await fetchSlug(kom.slug, kab, tipe);
      return [kom.slug, data] as [string, WholesaleResponse];
    }))
      .then(results => setGroupDataMap(new Map(results)))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [selectedGroup, kab, tipe, komoditasList]);

  // Background prefetch — warms L1+L2 for all groups after initial load
  useEffect(() => {
    if (komoditasList.length === 0) return;
    const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && ["slow-2g", "2g"].includes(conn.effectiveType)) return;

    let cancelled = false;

    async function prefetchRemaining() {
      for (const group of COMMODITY_GROUPS) {
        if (cancelled) break;
        const variants = komoditasList.filter((k: Komoditas) => group.match(k.nama));
        for (const kom of variants) {
          if (cancelled) break;
          if (slugCache.has(`${kom.slug}:${kab}:${tipe}`)) continue;
          try { await fetchSlug(kom.slug, kab, tipe); } catch { /* non-fatal */ }
          await new Promise<void>(res => setTimeout(res, 300));
        }
      }
    }

    const timer = setTimeout(prefetchRemaining, 1200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [kab, tipe, komoditasList]);

  // Variants belonging to the selected group
  const groupVariants = useMemo(() => {
    const group = COMMODITY_GROUPS.find(g => g.key === selectedGroup);
    if (!group) return [];
    return komoditasList.filter(k => group.match(k.nama));
  }, [selectedGroup, komoditasList]);

  const activeSeries = groupVariants.map(k => k.slug);

  const kabupatenSeriesList: Kabupaten[] = groupVariants.map(k => ({
    kode: k.slug,
    nama: k.nama,
  }));

  // Merge all variant regency_avg series into a single chartData array
  const chartData = useMemo<ChartPoint[]>(() => {
    if (groupDataMap.size === 0) return [];
    const map = new Map<string, ChartPoint>();
    for (const [slug, response] of groupDataMap) {
      for (const pt of response.regency_avg) {
        const k = pointKey(pt);
        if (!map.has(k)) map.set(k, { label: pointLabel(pt, tipe) });
        if (pt.harga != null) map.get(k)![slug] = pt.harga;
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, pt]) => pt)
      .slice(-nPeriods);
  }, [groupDataMap, tipe, nPeriods]);

  const allPrices = useMemo(
    () =>
      chartData.flatMap(pt =>
        activeSeries.map(s => pt[s]).filter((v): v is number => typeof v === "number"),
      ),
    [chartData, activeSeries],
  );

  const { yTicks, yDomain } = useMemo(() => computeYAxis(allPrices), [allPrices]);

  // Per-variant summary stats for the table
  const variantStats = useMemo(
    () =>
      groupVariants.map(variant => {
        const pts = (groupDataMap.get(variant.slug)?.regency_avg ?? []).slice(-nPeriods);
        const prices = pts.map(p => p.harga).filter((p): p is number => p != null);
        const last = pts.at(-1)?.harga ?? null;
        const changes: number[] = [];
        for (let i = 1; i < prices.length; i++) {
          const prev = prices[i - 1];
          if (prev !== 0) changes.push(((prices[i] - prev) / prev) * 100);
        }
        const avgChange =
          changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : null;
        return {
          slug: variant.slug,
          nama: variant.nama,
          last,
          change: avgChange,
          min: prices.length ? Math.min(...prices) : null,
          max: prices.length ? Math.max(...prices) : null,
        };
      }),
    [groupVariants, groupDataMap, nPeriods],
  );

  const hasData   = chartData.length > 0;
  const isEmpty   = !isLoading && chartData.length === 0;
  const kabLabel  = KAB_OPTIONS.find(o => o.kode === kab)?.label ?? "";
  const groupLabel = COMMODITY_GROUPS.find(g => g.key === selectedGroup)?.label ?? "";

  const BTN_BASE = "px-3 text-xs font-medium transition-colors border-r last:border-r-0";
  const BTN_ON   = "bg-[var(--brand-blue)] text-white";
  const BTN_OFF  = "bg-background text-steel hover:text-ink hover:bg-muted";

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
            <span>Analisis Pasar Grosir</span>
          </div>
          <span className="ml-8 text-xs font-mono text-steel">
            {isLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className="h-3 w-3 animate-spin" />Memuat…
              </span>
            ) : hasData ? (
              `${chartData.length} periode · ${chartData[0]?.label} → ${chartData.at(-1)?.label}`
            ) : (
              "Pilih komoditas"
            )}
          </span>
        </div>

        <div className="flex items-end gap-3 min-w-max">
          {/* Wilayah */}
          <div className="space-y-1.5 shrink-0">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Wilayah</label>
            <div className="flex border rounded-md overflow-hidden h-9">
              {KAB_OPTIONS.map(opt => (
                <button
                  key={opt.kode}
                  type="button"
                  onClick={() => setKab(opt.kode)}
                  className={`${BTN_BASE} ${kab === opt.kode ? BTN_ON : BTN_OFF}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tipe Periode */}
          <div className="space-y-1.5 shrink-0">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Tipe Periode</label>
            <div className="flex border rounded-md overflow-hidden h-9">
              {TIPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTipe(opt.value)}
                  className={`${BTN_BASE} ${tipe === opt.value ? BTN_ON : BTN_OFF}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tampilkan */}
          <div className="space-y-1.5 shrink-0">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Tampilkan</label>
            <div className="flex border rounded-md overflow-hidden h-9">
              {N_OPTIONS.map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNPeriods(n)}
                  className={`${BTN_BASE} ${nPeriods === n ? BTN_ON : BTN_OFF}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Page Body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex gap-4 items-start">

          {/* ── Commodity Panel ───────────────────────────────────── */}
          <Card className="w-44 shrink-0 gap-0 py-0 sticky top-4">
            <CardHeader className="px-3 py-3 border-b">
              <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-steel">
                Komoditas
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2 py-2 flex flex-col gap-0.5">
              {COMMODITY_GROUPS.map(group => {
                const variants = komoditasList.filter(k => group.match(k.nama));
                const isActive = selectedGroup === group.key;
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => setSelectedGroup(group.key)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                      isActive ? "bg-[var(--brand-blue)] text-white" : "hover:bg-muted text-ink"
                    }`}
                  >
                    <div className={`text-sm font-medium leading-tight ${isActive ? "text-white" : ""}`}>
                      {group.label}
                    </div>
                    {variants.length > 1 && (
                      <div className={`text-[11px] mt-0.5 ${isActive ? "text-white/70" : "text-steel"}`}>
                        {variants.length} varian
                      </div>
                    )}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* ── Chart + Table ─────────────────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-4">

            <Card className="gap-0 py-3">
              <CardHeader className="py-0 px-4 pb-2 block">
                <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                  {groupLabel}
                  <span className="font-normal text-steel text-xs">— {kabLabel}</span>
                  {isLoading && <RefreshCw className="h-3 w-3 animate-spin text-steel ml-1" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-3 relative">
                {isEmpty ? (
                  <div className="h-[340px] flex items-center justify-center rounded-xl border border-border bg-surface">
                    <p className="text-sm text-steel">Data tidak tersedia untuk kombinasi ini.</p>
                  </div>
                ) : (
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
                      kabupatenList={kabupatenSeriesList}
                      hetHA={null}
                      yTicks={yTicks}
                      yDomain={yDomain}
                    />
                  </Suspense>
                )}

                {hasData && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 pt-3 mt-1 border-t">
                    {activeSeries.map((slug, idx) => {
                      const variant = groupVariants.find(k => k.slug === slug);
                      return (
                        <div key={slug} className="flex items-center gap-1.5 text-xs text-steel">
                          <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
                            <line
                              x1="0" y1="5" x2="20" y2="5"
                              stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            />
                          </svg>
                          {variant?.nama ?? slug}
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

            {!isEmpty && !isLoading && (
              <Card className="gap-0 py-3">
                <CardHeader className="py-0 px-4 pb-2 block">
                  <CardTitle className="text-sm">Ringkasan Varian — {kabLabel}</CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0 overflow-x-auto">
                  <table className="w-full text-sm border-t">
                    <thead>
                      <tr className="bg-muted/40">
                        {["Varian", "Harga Terbaru", "Rata-rata Perubahan", "Terendah", "Tertinggi"].map(h => (
                          <th
                            key={h}
                            className="px-4 py-2.5 text-left text-xs font-semibold text-steel whitespace-nowrap border-b"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {variantStats.map((v, idx) => (
                        <tr key={v.slug} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-ink whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: LINE_COLORS[idx % LINE_COLORS.length] }}
                              />
                              {v.nama}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 font-medium text-ink tabular-nums text-xs">
                            {v.last != null ? formatPrice(v.last) : "–"}
                          </td>
                          <td
                            className={`px-4 py-2.5 font-medium tabular-nums text-xs ${
                              v.change == null ? "text-steel"
                              : v.change < 0   ? "text-green-600"
                              : v.change > 0   ? "text-red-500"
                              : "text-steel"
                            }`}
                          >
                            {v.change != null
                              ? `${v.change > 0 ? "+" : ""}${v.change.toFixed(1)}%`
                              : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-steel tabular-nums text-xs">
                            {v.min != null ? formatPrice(v.min) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-steel tabular-nums text-xs">
                            {v.max != null ? formatPrice(v.max) : "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
      <DataSourceFooter sources={["pihps"]} />
    </main>
  );
}
