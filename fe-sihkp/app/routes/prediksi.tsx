import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useSearchParams } from "react-router";
import { TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
import { db } from "~/lib/db";
import { cacheKey, checkL2, TTL } from "~/lib/cache";
import { usePrefetch } from "~/hooks/usePrefetch";
import { buildAllPredictionUrls } from "~/lib/prefetch-utils";

const PrediksiChart = lazy(() => import("~/components/PrediksiChart"));
import { Navbar } from "~/components/layout/Navbar";
import { DataSourceFooter } from "~/components/DataSourceFooter";
import { KpiCard } from "~/components/KpiCard";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { stripWilayahPrefix, formatPrice, type Kabupaten } from "~/lib/map-utils";

type ChartPoint = { label: string; historical: number | null; predicted: number | null };

const API_URL =
  (typeof window !== "undefined" ? import.meta.env.VITE_API_URL : undefined) ??
  "http://localhost:8000/api";

const TIPE_OPTIONS = [
  { value: "weekly", label: "Mingguan" },
] as const;

type Tipe = "weekly";

const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Komoditas {
  id: number;
  nama: string;
  satuan: string;
  harga_acuan: number | null;
}

interface SnapshotRow {
  pangan_id: number;
  periode_tipe: Tipe;
  periode_tahun: number;
  periode_nomor: number;
  periode_start: string;
  periode_end: string;
  harga_lkv: number | null;
  is_locf: boolean;
  change_pct: number | null;
}

interface HorizonPrediction {
  horizon: number;
  predicted_change_pct: number;
  predicted_harga_lkv: number;
  is_up: boolean;
  periode_start: string;
  periode_end: string;
}

interface PrediksiResponse {
  komoditas: { id: number; nama: string; satuan: string; harga_acuan: number };
  kabupaten: { kode: string; nama: string };
  periode_tipe: Tipe;
  current: { harga_lkv: number; change_pct: number | null; periode_start: string; periode_end: string };
  predictions: HorizonPrediction[];
  model_meta: { trained_at: string; train_periods: number; eval_mae_h1: number | null; eval_mae_h4: number | null; eval_rmse_h1: number | null; eval_rmse_h4: number | null };
}

// ---------------------------------------------------------------------------
// Module-level cache — L1 (Map, sub-ms) + L2 (Dexie, persistent across loads)
// ---------------------------------------------------------------------------

const snapshotCache = new Map<string, SnapshotRow[]>();
const prediksiCache = new Map<string, PrediksiResponse | null>();

async function fetchSnapshotsWithCache(
  snapKey: string,
  komoditasId: number,
  kabupatenKode: string,
  tipe: string,
  tipePasar: number,
  url: string,
): Promise<SnapshotRow[]> {
  const l2 = await checkL2<SnapshotRow[]>(
    () => db.snapshots.where("key").equals(snapKey).first(),
    raw => JSON.parse(raw) as SnapshotRow[],
    TTL.SNAPSHOT,
  );

  if (l2) {
    snapshotCache.set(snapKey, l2.data);
    if (l2.needsRefresh) {
      fetch(url).then(r => r.json()).then((rows: any[]) => {
        const parsed = rows.map((r: any) => ({
          ...r,
          harga_lkv:  r.harga_lkv  != null ? Number(r.harga_lkv)  : null,
          change_pct: r.change_pct != null ? Number(r.change_pct) : null,
        })) as SnapshotRow[];
        snapshotCache.set(snapKey, parsed);
        db.snapshots.put({ key: snapKey, komoditas_id: komoditasId, kabupaten_kode: kabupatenKode, tipe, tipe_pasar: tipePasar, data: JSON.stringify(parsed), cached_at: Date.now() });
      }).catch(() => {});
    }
    return l2.data;
  }

  const rows: any[] = await fetch(url).then(r => r.json());
  const parsed = rows.map((r: any) => ({
    ...r,
    harga_lkv:  r.harga_lkv  != null ? Number(r.harga_lkv)  : null,
    change_pct: r.change_pct != null ? Number(r.change_pct) : null,
  })) as SnapshotRow[];
  snapshotCache.set(snapKey, parsed);
  db.snapshots.put({ key: snapKey, komoditas_id: komoditasId, kabupaten_kode: kabupatenKode, tipe, tipe_pasar: tipePasar, data: JSON.stringify(parsed), cached_at: Date.now() });
  return parsed;
}

async function fetchPredictionsWithCache(
  predKey: string,
  komoditasId: number,
  kabupatenKode: string,
  tipe: string,
  horizon: number,
  tipePasar: number,
  url: string,
): Promise<PrediksiResponse | null> {
  const cached = prediksiCache.get(predKey);
  if (cached !== undefined) return cached;

  const l2 = await checkL2<PrediksiResponse | null>(
    () => db.predictions.where("key").equals(predKey).first(),
    raw => JSON.parse(raw) as PrediksiResponse | null,
    TTL.PREDICTION,
  );

  if (l2) {
    prediksiCache.set(predKey, l2.data);
    if (l2.needsRefresh) {
      fetch(url).then(r => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PrediksiResponse>;
      }).then(data => {
        prediksiCache.set(predKey, data);
        db.predictions.put({ key: predKey, komoditas_id: komoditasId, kabupaten_kode: kabupatenKode, tipe, horizon, tipe_pasar: tipePasar, data: JSON.stringify(data), cached_at: Date.now() });
      }).catch(() => {});
    }
    return l2.data;
  }

  const data = await fetch(url).then(r => {
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<PrediksiResponse>;
  });
  prediksiCache.set(predKey, data);
  db.predictions.put({ key: predKey, komoditas_id: komoditasId, kabupaten_kode: kabupatenKode, tipe, horizon, tipe_pasar: tipePasar, data: JSON.stringify(data), cached_at: Date.now() });
  return data;
}

async function clearCaches() {
  snapshotCache.clear();
  prediksiCache.clear();
  await db.snapshots.clear();
  await db.predictions.clear();
}

const WHOLESALE_KODES = ["8171", "8172"];

const SOURCE_OPTIONS = [
  { value: 1, label: "Pasar Tradisional" },
  { value: 3, label: "Pedagang Besar" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function periodLabel(t: Tipe, year: number, num: number): string {
  if (t === "weekly")     return `Mg${num} '${String(year).slice(2)}`;
  if (t === "monthly")    return `${BULAN[num - 1]} ${year}`;
  if (t === "quarterly")  return `Q${num} ${year}`;
  return `S${num} ${year}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${BULAN[d.getMonth()]}`;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function meta() {
  return [
    { title: "Prediksi Harga - Sistem Informasi Harga Komoditas" },
    { name: "description", content: "Prediksi tren harga komoditas menggunakan model XGBoost walk-forward" },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Prediksi() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { schedule: prefetch } = usePrefetch();

  const tipePasar = 1;
  const [komoditasId, setKomoditasId] = useState<number | null>(() => {
    const v = searchParams.get("komoditas_id");
    return v ? Number(v) : null;
  });
  const [kabupatenKode, setKabupatenKode] = useState<string | null>(() =>
    searchParams.get("kabupaten")
  );
  const [tipe, setTipe] = useState<Tipe>(() => {
    const v = searchParams.get("tipe") as Tipe | null;
    return TIPE_OPTIONS.some(o => o.value === v) ? (v as Tipe) : "weekly";
  });
  const [horizon] = useState(4);

  const [kabupatenList, setKabupatenList] = useState<Kabupaten[]>([]);
  const [komoditasList, setKomoditasList] = useState<Komoditas[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [prediksi, setPrediksi] = useState<PrediksiResponse | null>(null);
  const [prediksiError, setPrediksiError] = useState<"no_model" | "error" | null>(null);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Sync URL params
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tipe_pasar", String(tipePasar));
    if (komoditasId != null) params.set("komoditas_id", String(komoditasId));
    if (kabupatenKode)       params.set("kabupaten", kabupatenKode);
    params.set("tipe", tipe);
    setSearchParams(params, { replace: true });
  }, [tipePasar, komoditasId, kabupatenKode, tipe, setSearchParams]);

  // Initial kabupaten fetch (once)
  useEffect(() => {
    setIsLoadingMeta(true);
    fetch(`${API_URL}/kabupaten/`)
      .then(r => r.json())
      .then((kabs: Kabupaten[]) => {
        setKabupatenList(kabs);
        if (kabupatenKode == null) setKabupatenKode("8171");
      })
      .catch(console.error)
      .finally(() => setIsLoadingMeta(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload komoditas whenever source changes; reset dependent state
  useEffect(() => {
    fetch(`${API_URL}/komoditas/?sumber_id=1`)
      .then(r => r.json())
      .then((koms: Komoditas[]) => {
        setKomoditasList(koms);
        const defaultKom = koms.length > 0 ? koms[0].id : null;
        setKomoditasId(defaultKom);
        setSnapshots([]);
        setPrediksi(null);
        setPrediksiError(null);
        clearCaches();
      })
      .catch(console.error);
  }, [tipePasar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data fetch: snapshot history + prediction — parallel, with Dexie-backed L2 cache
  useEffect(() => {
    if (komoditasId == null || kabupatenKode == null) return;

    setIsLoadingData(true);
    setPrediksiError(null);

    const snapKey = `${komoditasId}:${kabupatenKode}:${tipe}:${tipePasar}`;
    const predKey = `${komoditasId}:${kabupatenKode}:${tipe}:${horizon}:${tipePasar}`;

    const snapCached = snapshotCache.get(snapKey);
    const snapPromise: Promise<SnapshotRow[]> = snapCached
      ? Promise.resolve(snapCached)
      : fetchSnapshotsWithCache(
          snapKey, komoditasId, kabupatenKode, tipe, tipePasar,
          `${API_URL}/harga/snapshot/?komoditas_id=${komoditasId}&kabupaten=${kabupatenKode}&tipe=${tipe}&tipe_pasar=${tipePasar}`,
        );

    const predCached = prediksiCache.get(predKey);
    const predPromise: Promise<PrediksiResponse | null> = predCached !== undefined
      ? Promise.resolve(predCached)
      : fetchPredictionsWithCache(
          predKey, komoditasId, kabupatenKode, tipe, horizon, tipePasar,
          `${API_URL}/harga/prediksi/?komoditas_id=${komoditasId}&kabupaten=${kabupatenKode}&tipe=${tipe}&horizon=${horizon}&tipe_pasar=${tipePasar}`,
        );

    Promise.all([snapPromise, predPromise])
      .then(([snaps, pred]) => {
        setSnapshots(snaps);
        if (pred === null) {
          setPrediksiError("no_model");
          setPrediksi(null);
        } else {
          setPrediksi(pred);
        }
        // Prefetch all prediction horizons (SW caches via fetch intercept)
        prefetch(buildAllPredictionUrls(komoditasId, kabupatenKode, tipe, tipePasar, API_URL));
      })
      .catch(() => setPrediksiError("error"))
      .finally(() => setIsLoadingData(false));
  }, [komoditasId, kabupatenKode, tipe, horizon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived state — computed during render, no extra effects (rerender-derived-state-no-effect)
  const kabMap = useMemo(
    () => new Map(kabupatenList.map(k => [k.kode, k])),
    [kabupatenList]
  );

  const selectedKom = komoditasList.find(k => k.id === komoditasId) ?? null;
  const selectedKab = kabupatenKode ? kabMap.get(kabupatenKode) : null;

  // Build unified chart data: last 8 historical + predicted
  const chartData = useMemo<ChartPoint[]>(() => {
    const historical = snapshots.slice(-8);
    if (historical.length === 0) return [];

    const points: ChartPoint[] = historical.map(s => ({
      label: periodLabel(s.periode_tipe, s.periode_tahun, s.periode_nomor),
      historical: s.harga_lkv,
      predicted: null,
    }));

    // Bridge: last historical point also gets the "predicted" value (connects lines)
    if (prediksi && prediksi.predictions.length > 0) {
      points[points.length - 1].predicted = prediksi.current.harga_lkv;

      for (const p of prediksi.predictions) {
        points.push({
          label: shortDate(p.periode_start),
          historical: null,
          predicted: p.predicted_harga_lkv,
        });
      }
    }

    return points;
  }, [snapshots, prediksi]);

  const allPrices = useMemo(() => {
    const hist = snapshots.slice(-8).map(s => s.harga_lkv).filter((v): v is number => v != null);
    const pred = prediksi?.predictions.map(p => p.predicted_harga_lkv) ?? [];
    return [...hist, ...pred];
  }, [snapshots, prediksi]);

  const yDomain = useMemo<[number, number] | undefined>(() => {
    if (allPrices.length === 0) return undefined;
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const pad = (max - min) * 0.15 || max * 0.1;
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
  }, [allPrices]);

  const h1 = prediksi?.predictions[0] ?? null;
  const hLast = prediksi?.predictions[prediksi.predictions.length - 1] ?? null;

  const hasFilters = komoditasId != null && kabupatenKode != null;
  const isReady = !isLoadingMeta && !isLoadingData;

  return (
    <main className="flex flex-col min-h-screen bg-surface">
      <Navbar />

      {/* Controls Bar */}
      <div className="w-full border-b bg-card px-4 sm:px-7 py-4 space-y-3 shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1.5 text-xs text-steel">
          <span>Provinsi Maluku</span>
          <span className="opacity-40">›</span>
          <span className="text-ink font-semibold">Prediksi Harga</span>
          {isLoadingData && <RefreshCw className="h-3 w-3 animate-spin ml-1" />}
        </div>

        <div className="flex items-end gap-3 min-w-max">
          {/* Komoditas */}
          <div className="space-y-1.5 shrink-0 w-52">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Komoditas</label>
            <Select
              value={komoditasId != null ? String(komoditasId) : ""}
              onValueChange={v => {
                setKomoditasId(Number(v));
                clearCaches();
              }}
            >
              <SelectTrigger className="h-9 w-full" aria-label="Komoditas"><SelectValue placeholder="Pilih komoditas" /></SelectTrigger>
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

          {/* Kabupaten */}
          <div className="space-y-1.5 shrink-0 w-52">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Kabupaten/Kota</label>
            <Select
              value={kabupatenKode ?? ""}
              onValueChange={v => {
                setKabupatenKode(v);
                clearCaches();
              }}
            >
              <SelectTrigger className="h-9 w-full" aria-label="Kabupaten/Kota"><SelectValue placeholder="Pilih kabupaten" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {kabupatenList.map(k => (
                    <SelectItem key={k.kode} value={k.kode}>
                      {stripWilayahPrefix(k.nama).name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Tipe */}
          <div className="space-y-1.5 shrink-0">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Tipe Periode</label>
            <div className="flex border rounded-md overflow-hidden h-9">
              {TIPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setTipe(opt.value);
                    clearCaches();
                  }}
                  className={`px-3 text-xs font-medium transition-colors w-full ${
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
        </div>
      </div>

      {/* Page Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* KPI Cards */}
        <section className="flex items-center gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
          <KpiCard
            className="w-52"
            fixedHeight
            label="Harga Saat Ini"
            value={prediksi ? formatPrice(prediksi.current.harga_lkv) : isLoadingData ? "…" : "—"}
            hint={prediksi
              ? `${shortDate(prediksi.current.periode_start)} – ${shortDate(prediksi.current.periode_end)}`
              : undefined}
            definition="Harga terakhir yang diketahui (LKV) pada periode terkini."
            icon={<Minus className="h-3.5 w-3.5" />}
            isLoading={isLoadingData}
          />
          <KpiCard
            className="w-52"
            fixedHeight
            label="Prediksi H+1"
            value={h1 ? formatPrice(Math.round(h1.predicted_harga_lkv)) : "—"}
            hint={h1 ? fmtPct(h1.predicted_change_pct) : undefined}
            valueClass={h1 ? (h1.is_up ? "text-red-500" : "text-emerald-600") : ""}
            definition="Prediksi harga 1 periode ke depan berdasarkan model XGBoost."
            icon={h1
              ? h1.is_up
                ? <TrendingUp className="h-3.5 w-3.5 text-red-400" />
                : <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
              : <Minus className="h-3.5 w-3.5" />}
            isLoading={isLoadingData}
          />
          <KpiCard
            className="w-52"
            fixedHeight
            label={`Prediksi H+${horizon}`}
            value={hLast ? formatPrice(Math.round(hLast.predicted_harga_lkv)) : "—"}
            hint={hLast ? fmtPct(hLast.predicted_change_pct) : undefined}
            valueClass={hLast ? (hLast.is_up ? "text-red-500" : "text-emerald-600") : ""}
            definition={`Prediksi harga ${horizon} periode ke depan.`}
            icon={hLast
              ? hLast.is_up
                ? <TrendingUp className="h-3.5 w-3.5 text-red-400" />
                : <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
              : <Minus className="h-3.5 w-3.5" />}
            isLoading={isLoadingData}
          />
          {prediksi?.model_meta && (
            <>
              <KpiCard
                className="w-52"
                fixedHeight
                label="Akurasi Model (MAE)"
                value={prediksi.model_meta.eval_mae_h1 != null
                  ? `${prediksi.model_meta.eval_mae_h1.toFixed(2)}%`
                  : "—"}
                hint={`H+4: ${prediksi.model_meta.eval_mae_h4 != null ? prediksi.model_meta.eval_mae_h4.toFixed(2) + "%" : "—"} · Dilatih ${prediksi.model_meta.trained_at}`}
                definition="Mean Absolute Error (MAE) pada level harga dari walk-forward validation 5-fold. Semakin kecil, semakin akurat."
                isLoading={isLoadingData}
              />
              <KpiCard
                className="w-52"
                fixedHeight
                label="RMSE Model"
                value={prediksi.model_meta.eval_rmse_h1 != null
                  ? `${prediksi.model_meta.eval_rmse_h1.toFixed(2)}%`
                  : "—"}
                hint={`H+4: ${prediksi.model_meta.eval_rmse_h4 != null ? prediksi.model_meta.eval_rmse_h4.toFixed(2) + "%" : "—"} · Dilatih ${prediksi.model_meta.trained_at}`}
                definition="Root Mean Square Error (RMSE) pada level harga — lebih sensitif terhadap error besar dibanding MAE. Semakin kecil, semakin akurat."
                isLoading={isLoadingData}
              />
            </>
          )}
        </section>

        {/* Chart + Predictions Table */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">

          {/* Chart — lazy-loaded to keep Recharts out of the initial bundle */}
          <Suspense fallback={
            <div className="h-[410px] rounded-xl border bg-card flex items-center justify-center">
              <RefreshCw className="h-5 w-5 animate-spin text-steel" />
            </div>
          }>
            <PrediksiChart
              chartData={chartData}
              yDomain={yDomain}
              prediksi={prediksi}
              prediksiError={prediksiError}
              isLoading={isLoadingData}
              hasFilters={hasFilters}
              selectedKomNama={selectedKom?.nama}
              selectedKomSatuan={selectedKom?.satuan}
              selectedKabNama={selectedKab?.nama}
              komoditasId={komoditasId}
              kabupatenKode={kabupatenKode}
              tipe={tipe}
            />
          </Suspense>

          {/* Predictions Table */}
          <Card className="gap-0 py-3">
            <CardHeader className="py-0 px-4 pb-2 block">
              <CardTitle className="text-sm">Detail Prediksi</CardTitle>
              {prediksi && (
                <p className="text-xs text-steel mt-0.5">
                  Basis: {formatPrice(prediksi.current.harga_lkv)} per {shortDate(prediksi.current.periode_end)}
                </p>
              )}
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {isLoadingData ? (
                <div className="flex items-center justify-center py-10">
                  <RefreshCw className="h-4 w-4 animate-spin text-steel" />
                </div>
              ) : prediksi?.predictions.length ? (
                <table className="w-full text-sm border-t">
                  <thead>
                    <tr className="bg-muted/40">
                      {["Periode", "Harga Prediksi", "Perubahan"].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-steel border-b">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {prediksi.predictions.map((p, i) => (
                      <tr key={p.horizon} className={`hover:bg-muted/30 transition-colors ${i % 2 !== 0 ? "bg-muted/10" : ""}`}>
                        <td className="px-4 py-2.5 text-xs text-steel whitespace-nowrap">
                          <span className="font-medium text-ink">H+{p.horizon}</span>
                          <span className="block text-[10px] opacity-60">
                            {shortDate(p.periode_start)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs font-medium tabular-nums text-ink">
                          {formatPrice(Math.round(p.predicted_harga_lkv))}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-semibold px-1.5 py-0 ${
                              p.is_up
                                ? "border-red-200 text-red-600 bg-red-50"
                                : "border-emerald-200 text-emerald-700 bg-emerald-50"
                            }`}
                          >
                            {fmtPct(p.predicted_change_pct)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="py-10 text-center text-xs text-steel px-4">
                  {prediksiError === "no_model"
                    ? "Model belum dilatih untuk stream ini."
                    : "Pilih filter untuk melihat prediksi."}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Empty / initial state */}
        {!hasFilters && isReady && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="h-14 w-14 rounded-full bg-background border flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-[var(--brand-blue)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink">Prediksi harga komoditas</p>
              <p className="text-xs text-steel mt-1">
                Pilih komoditas dan kabupaten di atas untuk melihat prediksi dari model XGBoost.
              </p>
            </div>
          </div>
        )}
      </div>

      <footer className="border-t bg-muted/40 mt-6">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-start gap-2">
          <svg
            className="h-3.5 w-3.5 mt-0.5 shrink-0 text-steel/50"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 10.5h-1.5v-5h1.5v5zm0-6.5h-1.5V3.5h1.5V5z" />
          </svg>
          <p className="text-[11px] text-steel/60 leading-relaxed">
            Prediksi bersifat indikatif. Model mengasumsikan kondisi eksternal —
            logistik, cuaca, hasil panen, harga bahan bakar, dan kebijakan harga — relatif
            stabil. Perubahan mendadak pada faktor-faktor tersebut dapat menyebabkan
            realisasi harga berbeda signifikan dari prediksi.
          </p>
        </div>
      </footer>
      <DataSourceFooter sources={["sp2kp"]} />
    </main>
  );
}
