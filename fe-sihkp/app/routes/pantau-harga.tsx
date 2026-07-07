import type { Route } from "./+types/pantau-harga";
import React, { lazy, Suspense, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useLoaderData } from "react-router";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Navbar } from "~/components/layout/Navbar";
import { DataSourceFooter } from "~/components/DataSourceFooter";
import { KabupatenPanel } from "~/components/layout/KabupatenPanel";
import { KpiCard } from "~/components/KpiCard";
import { TrendingUp, TrendingDown, MapPin, ShoppingBasket, Download, Minus, Plus, GitCompare, ChevronRight, Loader2, ArrowLeftRight, Clock, Tag, BarChart2, CheckCircle2, ArrowUpDown, ArrowUp } from "lucide-react";
import type { GeoJsonObject, Feature } from "geojson";
import type { PathOptions } from "leaflet";
import {
  MODES, getSliderMax, getPeriodParams, getPeriodLabel, findDefaultIndex, findIndexByParams, getDateLookup,
  type Mode, type PeriodOptionsResponse, type AppliedPeriod,
} from "~/lib/period-utils";
import {
  formatPrice, getChoroChangeColor, stripWilayahPrefix,
  CHANGE_STOPS, CHANGE_BANDS,
  type Kabupaten, type PriceEntry,
} from "~/lib/map-utils";
import { db } from "~/lib/db";
import { cacheKey, checkL2, TTL } from "~/lib/cache";
import { usePrefetch } from "~/hooks/usePrefetch";
import { buildAdjacentPetaUrls } from "~/lib/prefetch-utils";
const MapChoropleth = lazy(() => import("~/components/MapChoropleth"));

const API_URL = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8000/api";

const WHOLESALE_KODES = ["8171", "8172"];

const SOURCE_OPTIONS = [
  { value: 1, label: "Pasar Tradisional" },
  { value: 3, label: "Pedagang Besar" },
] as const;

// Module-level cache — survives re-navigation within the same session.
let geoJsonCache: import("geojson").GeoJsonObject | null = null;

interface Komoditas { id: number; nama: string; satuan: string; harga_acuan?: string | null; }
interface TableRow {
  id: number; nama: string; satuan: string;
  harga: number; harga_terakhir: number | null;
  change_pct: number | null; is_up: boolean;
}
type TableState =
  | { mode: "semua"; rows: PriceEntry[] }
  | { mode: "kabupaten"; rows: TableRow[] }
  | null;
export async function loader({ request }: Route.LoaderArgs) {
  const api = process.env.SERVER_API_URL ?? "http://localhost:8000/api";
  const url = new URL(request.url);
  const komoditasParam = url.searchParams.get("komoditas");
  const modeParam = url.searchParams.get("mode");
  const hasUrlPeriodParams = ["tahun", "minggu", "bulan", "kuartal", "semester", "tanggal"].some(
    k => url.searchParams.has(k)
  );

  const tipePasarParam = url.searchParams.get("tipe_pasar") ?? "1";
  const qs = new URLSearchParams({ tipe_pasar: tipePasarParam });
  if (komoditasParam) qs.set("komoditas_nama", komoditasParam);
  if (modeParam) qs.set("mode", modeParam);
  for (const k of ["tahun", "minggu", "bulan", "kuartal", "semester", "tanggal"]) {
    const v = url.searchParams.get(k);
    if (v) qs.set(k, v);
  }

  type InitialResponse = {
    kabupaten: Kabupaten[];
    komoditas: Komoditas[];
    period_options: PeriodOptionsResponse | null;
    peta: PriceEntry[];
    applied: {
      komoditas_id: number;
      komoditas_nama: string;
      mode: Mode;
      params: Record<string, string | number>;
      label: string;
      initial_index: number;
    } | null;
  };

  const data: InitialResponse = await fetch(`${api}/harga/peta/initial/?${qs}`)
    .then(r => r.json())
    .catch(() => ({ kabupaten: [], komoditas: [], period_options: null, peta: [], applied: null }));

  const priceByKab: Record<string, PriceEntry> = {};
  for (const e of data.peta) priceByKab[e.kode] = e;

  const appliedPeriod: AppliedPeriod | null = data.applied
    ? { mode: data.applied.mode, komoditas: data.applied.komoditas_nama, params: data.applied.params, label: data.applied.label }
    : null;

  return {
    kabupatenList: data.kabupaten,
    komoditasList: data.komoditas,
    periodOptions: data.period_options,
    priceByKab,
    appliedPeriod,
    initialIndex: data.applied?.initial_index ?? 0,
    urlParamsApplied: hasUrlPeriodParams,
  };
}

export const links: Route.LinksFunction = () => [
  { rel: "preload", href: "/kabupaten.geojson", as: "fetch" },
  ...(import.meta.env.PROD ? [{ rel: "modulepreload" as const, href: "/assets/map-choropleth.js" }] : []),
];

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Pantau Harga - Sistem Informasi Harga Komoditas" },
    { name: "description", content: "Pantau harga komoditas di pasar tradisional Provinsi Maluku" },
  ];
}

export default function PasarTraditional() {
  const loaderData = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { schedule: prefetch } = usePrefetch();

  // Capture initial URL params once — consumed on first period options load
  const initialUrl = useRef({
    mode:     (searchParams.get("mode") as Mode) || null,
    komoditas: searchParams.get("komoditas") || null,
    tahun:    searchParams.get("tahun")    ? Number(searchParams.get("tahun"))    : null,
    minggu:   searchParams.get("minggu")   ? Number(searchParams.get("minggu"))   : null,
    bulan:    searchParams.get("bulan")    ? Number(searchParams.get("bulan"))    : null,
    kuartal:  searchParams.get("kuartal")  ? Number(searchParams.get("kuartal"))  : null,
    semester: searchParams.get("semester") ? Number(searchParams.get("semester")) : null,
    tanggal:  searchParams.get("tanggal")  || null,
    kab:      searchParams.get("kab")      || "",
    compare:  searchParams.get("compare") === "1",
    ca:       searchParams.get("ca")       || "",
    cb:       searchParams.get("cb")       || "",
    applied:  false,
  });

  // Mark URL params as already applied when loader handled them
  if (loaderData.urlParamsApplied) initialUrl.current.applied = true;

  const [tipePasar, setTipePasar] = useState<1 | 3>(() => {
    const v = Number(searchParams.get("tipe_pasar"));
    return v === 3 ? 3 : 1;
  });
  const isFirstMount = useRef(true);

  const [mode, setMode] = useState<Mode>(loaderData.appliedPeriod?.mode ?? initialUrl.current.mode ?? "weekly");
  const [sliderIndex, setSliderIndex] = useState(loaderData.initialIndex ?? 0);
  const [committedIndex, setCommittedIndex] = useState(loaderData.initialIndex ?? 0);
  const [isLoading, setIsLoading] = useState(false);
  const [periodOptions, setPeriodOptions] = useState<PeriodOptionsResponse | null>(loaderData.periodOptions ?? null);
  const [komoditas, setKomoditas] = useState(loaderData.appliedPeriod?.komoditas ?? initialUrl.current.komoditas ?? "Bawang Merah");
  const [kabupaten, setKabupaten] = useState(initialUrl.current.kab);

  const [appliedPeriod, setAppliedPeriod] = useState<AppliedPeriod | null>(loaderData.appliedPeriod ?? null);

  const [kabupatenList, setKabupatenList] = useState<Kabupaten[]>(loaderData.kabupatenList);
  const [komoditasList, setKomoditasList] = useState<Komoditas[]>(loaderData.komoditasList);
  const [geoJsonData, setGeoJsonData] = useState<GeoJsonObject | null>(null);

  const [priceByKab, setPriceByKab] = useState<Record<string, PriceEntry>>(loaderData.priceByKab ?? {});
  const [tableState, setTableState] = useState<TableState>(() => {
    const rows = Object.values(loaderData.priceByKab ?? {}) as PriceEntry[];
    return rows.length > 0 ? { mode: "semua", rows } : null;
  });
  const [isMounted, setIsMounted] = useState(false);

  const [compareMode, setCompareMode] = useState(initialUrl.current.compare);
  const [compareA, setCompareA] = useState<string>(initialUrl.current.ca);
  const [compareB, setCompareB] = useState<string>(initialUrl.current.cb);
  const [compareRows, setCompareRows] = useState<{ a: TableRow[]; b: TableRow[] }>({ a: [], b: [] });

  const [hoveredKabupaten, setHoveredKabupaten] = useState<string | null>(null);
  const [hoverSyncEnabled, setHoverSyncEnabled] = useState(true);
  const layerRefs = useRef<Record<string, { layer: any; feature: Feature }>>({});
  const prevHoveredRef = useRef<string | null>(null);
  const mapRef = useRef<any>(null);
  const hoverPanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverSourceRef = useRef<'map' | 'sidebar' | null>(null);
  const compTableRef = useRef<HTMLElement>(null);
  const mapCardRef = useRef<HTMLDivElement>(null);
  const [mapCardInView, setMapCardInView] = useState(true);
  const [tableInView, setTableInView] = useState(false);

  const getKomoditasIdByName = useCallback(
    (name: string) => komoditasList.find(k => k.nama === name)?.id ?? -1,
    [komoditasList]
  );

  // Skip the initial peta/options fetch when loader already fetched it for this komoditas
  const loadedOptionsFor = useRef<string | null>(loaderData.appliedPeriod?.komoditas ?? null);
  // Skip the initial handleSubmit when loader already fetched price data
  const skipInitialSubmit = useRef(!!loaderData.appliedPeriod);

  useEffect(() => {
    // Defer Leaflet init to next frame so it doesn't block LCP paint
    requestAnimationFrame(() => setIsMounted(true));
    void import("~/components/MapChoropleth");
  }, []);

  useEffect(() => {
    if (geoJsonCache) {
      setGeoJsonData(geoJsonCache);
    } else {
      (async () => {
        const l2 = await checkL2<{ id: number }>(
          () => db.geojson.get(1) as any,
          raw => JSON.parse(raw) as any,
          TTL.GEOJSON,
        );

        if (l2) {
          geoJsonCache = l2.data as any;
          setGeoJsonData(l2.data as any);
          return;
        }

        const data = await fetch("/kabupaten.geojson").then(r => r.json());
        geoJsonCache = data;
        setGeoJsonData(data);
        db.geojson.put({ id: 1, data: JSON.stringify(data), cached_at: Date.now() });
      })();
    }
  }, []);

  // Source switch: reload komoditas + reset all price state when tipePasar changes
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    // Reset all derived state
    setPeriodOptions(null);
    setAppliedPeriod(null);
    setPriceByKab({});
    setTableState(null);
    setKabupaten("");
    setCompareMode(false);
    setCompareA("");
    setCompareB("");
    setCompareRows({ a: [], b: [] });
    loadedOptionsFor.current = null;
    skipInitialSubmit.current = false;

    const qs = new URLSearchParams({ tipe_pasar: String(tipePasar) });
    fetch(`${API_URL}/harga/peta/initial/?${qs}`)
      .then(r => r.json())
      .then((data: { komoditas: Komoditas[]; period_options: PeriodOptionsResponse | null }) => {
        setKomoditasList(data.komoditas);
        if (data.komoditas.length > 0) {
          const firstName = data.komoditas[0].nama;
          setKomoditas(firstName);
        }
        if (data.period_options) {
          setPeriodOptions(data.period_options);
          const idx = findDefaultIndex("weekly", data.period_options);
          setMode("weekly");
          setSliderIndex(idx);
          setCommittedIndex(idx);
        }
      })
      .catch(console.error);
  }, [tipePasar]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!komoditas || komoditasList.length === 0) return;
    // Skip: loader already fetched period options for this komoditas
    if (loadedOptionsFor.current === komoditas) {
      loadedOptionsFor.current = null;
      return;
    }
    const id = getKomoditasIdByName(komoditas);
    if (id === -1) return;
    setPeriodOptions(null);
    setAppliedPeriod(null);

    function applyOpts(opts: PeriodOptionsResponse) {
      setPeriodOptions(opts);
      const url = initialUrl.current;
      let resolvedMode: Mode;
      let idx: number;
      if (!url.applied && url.mode) {
        resolvedMode = url.mode;
        idx = findIndexByParams(resolvedMode, {
          tahun: url.tahun, minggu: url.minggu, bulan: url.bulan,
          kuartal: url.kuartal, semester: url.semester, tanggal: url.tanggal,
        }, opts);
        url.applied = true;
      } else {
        resolvedMode = opts.defaults.mode as Mode;
        idx = findDefaultIndex(resolvedMode, opts);
      }
      setMode(resolvedMode);
      setSliderIndex(idx);
      setCommittedIndex(idx);
    }

    (async () => {
      const l2 = await checkL2<PeriodOptionsResponse>(
        () => db.options_cache.get([id, tipePasar]) as any,
        raw => JSON.parse(raw),
        TTL.OPTIONS,
      );
      if (l2) {
        applyOpts(l2.data);
        if (!l2.needsRefresh) return;
        // stale — revalidate silently in background (SW also handles this)
      }

      fetch(`${API_URL}/harga/peta/options/?komoditas_id=${id}&tipe_pasar=${tipePasar}`)
        .then(r => r.json())
        .then((opts: PeriodOptionsResponse) => {
          db.options_cache.put({ komoditas_id: id, tipe_pasar: tipePasar, data: JSON.stringify(opts), cached_at: Date.now() });
          if (!l2) applyOpts(opts);
        })
        .catch(console.error);
    })();
  }, [komoditas, komoditasList.length, getKomoditasIdByName, tipePasar]);

  useEffect(() => {
    if (!komoditas || !periodOptions || komoditasList.length === 0) return;
    // Skip: loader already fetched price data for this period
    if (skipInitialSubmit.current) {
      skipInitialSubmit.current = false;
      return;
    }
    const t = setTimeout(() => { handleSubmit(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, committedIndex, komoditas, periodOptions, komoditasList.length]);

  function buildPeriodBody(period: AppliedPeriod): Record<string, unknown> {
    return { ...period.params, tipe_pasar: tipePasar };
  }

  function fetchTableForKabupaten(kode: string, period: AppliedPeriod) {
    const params = new URLSearchParams(
      Object.fromEntries(
        Object.entries({ kabupaten: kode, ...buildPeriodBody(period) })
          .map(([k, v]) => [k, String(v)])
      )
    );
    fetch(`${API_URL}/harga/update/?${params}`)
      .then(r => r.json())
      .then(data => {
        const rows: TableRow[] = data.data ?? [];
        setTableState({ mode: "kabupaten", rows });
      })
      .catch(console.error);
  }

  async function fetchCompareRows(kode: string, period: AppliedPeriod): Promise<TableRow[]> {
    if (!kode) return [];
    const params = new URLSearchParams(
      Object.fromEntries(
        Object.entries({ kabupaten: kode, ...buildPeriodBody(period) })
          .map(([k, v]) => [k, String(v)])
      )
    );
    const res = await fetch(`${API_URL}/harga/update/?${params}`);
    const data = await res.json();
    return (data.data ?? []) as TableRow[];
  }

  async function handleSubmit() {
    if (!komoditas || !periodOptions) return;
    setIsLoading(true);
    const params = getPeriodParams(mode, committedIndex, periodOptions);
    const label = getPeriodLabel(mode, committedIndex, periodOptions);
    const period: AppliedPeriod = { mode, komoditas, params, label };

    const komoditasId = getKomoditasIdByName(komoditas);
    if (komoditasId === -1) {
      console.warn("Komoditas tidak ditemukan");
      return;
    }

    try {
      const qs = new URLSearchParams();

      for (const [k, v] of Object.entries(params)) {
        qs.set(k, String(v));
      }
      qs.set("komoditas_id", String(komoditasId));
      qs.set("tipe_pasar", String(tipePasar));

      const petaKey = cacheKey(komoditasId, tipePasar, qs.toString());
      const l2Peta = await checkL2<PriceEntry[]>(
        () => db.peta_prices.where("key").equals(petaKey).first(),
        raw => JSON.parse(raw),
        TTL.PETA,
      );

      let petaData: PriceEntry[];
      if (l2Peta) {
        petaData = l2Peta.data;
        const applyMap: Record<string, PriceEntry> = {};
        for (const e of petaData) applyMap[e.kode] = e;
        setPriceByKab(applyMap);
        setAppliedPeriod(period);
        if (!l2Peta.needsRefresh) {
          // cache is fresh — skip network, handle table/compare below
        } else {
          // stale — revalidate in background
          fetch(`${API_URL}/harga/peta/?${qs.toString()}`)
            .then(r => r.json())
            .then((fresh: PriceEntry[]) => {
              db.peta_prices.put({ key: petaKey, komoditas_id: komoditasId, tipe_pasar: tipePasar, mode, data: JSON.stringify(fresh), cached_at: Date.now() });
            })
            .catch(() => {});
        }
      } else {
        petaData = await fetch(`${API_URL}/harga/peta/?${qs.toString()}`).then(r => r.json());
        db.peta_prices.put({ key: petaKey, komoditas_id: komoditasId, tipe_pasar: tipePasar, mode, data: JSON.stringify(petaData), cached_at: Date.now() });
        const map: Record<string, PriceEntry> = {};
        for (const e of petaData) map[e.kode] = e;
        setPriceByKab(map);
        setAppliedPeriod(period);
      }

      // Prefetch adjacent periods + alternate tipe_pasar (SW caches via fetch intercept)
      if (periodOptions) {
        prefetch(buildAdjacentPetaUrls(komoditasId, tipePasar, mode, committedIndex, periodOptions, API_URL));
      }

      if (compareMode) {
        const [a, b] = await Promise.all([
          fetchCompareRows(compareA, period),
          fetchCompareRows(compareB, period),
        ]);
        setCompareRows({ a, b });
        setTableState(null);
      } else if (kabupaten) {
        fetchTableForKabupaten(kabupaten, period);
      } else {
        const rows: PriceEntry[] = petaData;
        setTableState({ mode: "semua", rows });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKabupatenClick(kode: string) {
    if (compareMode) {
      if (!compareA) setCompareA(kode);
      else if (!compareB && kode !== compareA) setCompareB(kode);
      return;
    }
    // Read Leaflet bounds before any state mutations to avoid forced reflow
    const bounds = layerRefs.current[kode]?.layer?.getBounds?.();
    if (kode === kabupaten) {
      setKabupaten("");
      setHoverSyncEnabled(true);
      if (appliedPeriod) setTableState({ mode: "semua", rows: Object.values(priceByKab) });
      requestAnimationFrame(() =>
        mapRef.current?.flyTo([-5.3555, 129.5], 7, { animate: true, duration: 0.6 })
      );
      return;
    }
    setKabupaten(kode);
    setHoverSyncEnabled(false);
    if (bounds) {
      const maxSpan = Math.max(bounds.getNorth() - bounds.getSouth(), bounds.getEast() - bounds.getWest());
      const maxZoom = maxSpan < 0.5 ? 11 : maxSpan < 1.5 ? 10 : 9;
      requestAnimationFrame(() =>
        mapRef.current?.flyToBounds(bounds, { padding: [30, 30], maxZoom, duration: 0.6 })
      );
    }
    if (appliedPeriod) fetchTableForKabupaten(kode, appliedPeriod);
  }

  function toggleCompareMode() {
    setCompareMode(prev => {
      const next = !prev;
      if (next) {
        setKabupaten("");
        setCompareA("");
        setCompareB("");
        setCompareRows({ a: [], b: [] });
      }
      return next;
    });
  }

  useEffect(() => {
    if (!compareMode || !appliedPeriod) return;
    let cancelled = false;
    (async () => {
      const [a, b] = await Promise.all([
        fetchCompareRows(compareA, appliedPeriod),
        fetchCompareRows(compareB, appliedPeriod),
      ]);
      if (!cancelled) setCompareRows({ a, b });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareA, compareB, compareMode, appliedPeriod?.label]);

  // Scroll to comparison table when both slots are filled
  // Delayed past React Router's ScrollRestoration which resets scroll on setSearchParams navigation
  useEffect(() => {
    if (!compareB || !compareA) return;
    const t = setTimeout(() => {
      compTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
    return () => clearTimeout(t);
  }, [compareB]);

  // Track map card visibility to toggle commodity name highlight on scroll
  useEffect(() => {
    const el = mapCardRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setMapCardInView(entry.isIntersecting), { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Track comparison table visibility for the same highlight effect
  useEffect(() => {
    const el = compTableRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setTableInView(entry.isIntersecting), { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Sync filter state to URL (replace so slider scrubbing doesn't pollute history)
  useEffect(() => {
    if (!periodOptions) return;
    const p = new URLSearchParams();
    p.set("tipe_pasar", String(tipePasar));
    p.set("mode", mode);
    p.set("komoditas", komoditas);
    const params = getPeriodParams(mode, committedIndex, periodOptions);
    for (const [k, v] of Object.entries(params)) {
      if (k !== "mode") p.set(k, String(v));
    }
    if (kabupaten) p.set("kab", kabupaten);
    if (compareMode) {
      p.set("compare", "1");
      if (compareA) p.set("ca", compareA);
      if (compareB) p.set("cb", compareB);
    }
    setSearchParams(p, { replace: true, preventScrollReset: true });
  }, [tipePasar, mode, committedIndex, komoditas, kabupaten, compareMode, compareA, compareB, periodOptions, setSearchParams]);

  function handlePrev() {
    const next = Math.max(0, sliderIndex - 1);
    setSliderIndex(next);
    setCommittedIndex(next);
  }

  function handleNext() {
    const next = Math.min(sliderMax, sliderIndex + 1);
    setSliderIndex(next);
    setCommittedIndex(next);
  }

  function handleReset() {
    if (!periodOptions) return;
    const idx = findDefaultIndex("weekly", periodOptions);
    setMode("weekly");
    setSliderIndex(idx);
    setCommittedIndex(idx);
    setKomoditas("");
    setKabupaten("");
    requestAnimationFrame(() =>
      mapRef.current?.flyTo([-5.3555, 129.5], 7, { animate: true, duration: 0.6 })
    );
    setCompareMode(false);
    setCompareA("");
    setCompareB("");
    setCompareRows({ a: [], b: [] });
    setAppliedPeriod(null);
    setPriceByKab({});
    setTableState(null);
    setSearchParams(new URLSearchParams(), { replace: true, preventScrollReset: true });
  }

  const prices = Object.values(priceByKab).map(e => e.harga).filter((h): h is number => h !== null);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const hasData = prices.length > 0;

  const styleFeature = useCallback((feature: Feature): PathOptions => {
    const kode = feature.id;
    if (!kode) return {};
    const pct = priceByKab[kode]?.change_pct ?? null;
    const noData = pct == null;
    return {
      fillColor: getChoroChangeColor(pct),
      fillOpacity: noData ? 0.4 : 0.78,
      color: "#FFFFFF",
      weight: 0.5,
      dashArray: noData ? "3,3" : undefined,
    };
  }, [priceByKab]);

  // Sidebar → map: imperatively update Leaflet layer styles when hoveredKabupaten changes
  useEffect(() => {
    const prev = prevHoveredRef.current;
    prevHoveredRef.current = hoveredKabupaten;

    let rafId: number | undefined;
    if (hoverSyncEnabled) {
      rafId = requestAnimationFrame(() => {
        // Restore previous layer style
        if (prev && prev !== hoveredKabupaten) {
          const ref = layerRefs.current[prev];
          if (ref) ref.layer.setStyle(styleFeature(ref.feature));
        }
        // Apply glow — skip when hover came from map (event handler already applied it)
        if (hoveredKabupaten && hoverSourceRef.current !== 'map') {
          const ref = layerRefs.current[hoveredKabupaten];
          if (ref) {
            ref.layer.setStyle({ fillOpacity: 0.92, weight: 1.5, color: "#FFFFFF" });
            ref.layer.bringToFront();
          }
        }
      });
    }

    // Debounced pan — only when sync is enabled AND hover came from sidebar/keyboard (not map)
    if (hoverPanTimerRef.current) clearTimeout(hoverPanTimerRef.current);
    if (hoverSyncEnabled && hoveredKabupaten && hoverSourceRef.current === 'sidebar') {
      hoverPanTimerRef.current = setTimeout(() => {
        const ref = layerRefs.current[hoveredKabupaten];
        if (ref) mapRef.current?.panTo(ref.layer.getBounds().getCenter(), { animate: true, duration: 0.25 });
      }, 120);
    }

    return () => {
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      if (hoverPanTimerRef.current) clearTimeout(hoverPanTimerRef.current);
    };
  }, [hoveredKabupaten, hoverSyncEnabled, styleFeature]);

  function onEachFeature(feature: Feature, layer: L.Layer) {
    const props = feature.properties as any;
    let kode = feature.id;
    if (typeof kode === "undefined") return;
    if (typeof kode === "number") kode = kode.toString();
    const nama: string = props?.nama ?? kode;
    const entry = priceByKab[kode];

    const priceLine = entry?.harga != null
      ? `<div style="font-variant-numeric:tabular-nums">${formatPrice(entry.harga)}</div>`
      : `<div style="opacity:.7">Data tidak tersedia</div>`;
    const prevLine = entry?.harga_terakhir != null
      ? `<div style="font-size:11px;color:#d1d5db;font-variant-numeric:tabular-nums">sebelumnya: ${formatPrice(entry.harga_terakhir)}</div>`
      : "";
    const pctLine = entry?.change_pct != null
      ? `<div style="margin-top:2px;font-size:11px;color:${entry.change_pct > 0 ? "#fca5a5" : entry.change_pct < 0 ? "#86efac" : "#d1d5db"}">${entry.change_pct > 0 ? "+" : ""}${entry.change_pct}% dibanding periode sebelumnya</div>`
      : "";
    const html = `<div style="font-weight:600;margin-bottom:2px">${nama}</div>${priceLine}${prevLine}${pctLine}`;

    layer.bindTooltip(html, {
      sticky: true,
      className: "sihpm-map-tooltip",
      direction: "top",
      offset: [0, -8],
    });

    layerRefs.current[kode as string] = { layer, feature };
    const origStyle = styleFeature(feature);
    layer.on({
      mouseover: () => {
        hoverSourceRef.current = 'map';
        setHoveredKabupaten(kode as string);
        (layer as any).setStyle({ fillOpacity: 0.92, weight: 1.5, color: "#FFFFFF" });
        (layer as any).bringToFront();
      },
      mouseout: () => {
        hoverSourceRef.current = null;
        setHoveredKabupaten(null);
        (layer as any).setStyle(origStyle);
      },
    });

    (layer as any).on("click", () => handleKabupatenClick(kode));
  }

  const kabMap = useMemo(
    () => new Map(kabupatenList.map(k => [k.kode, k])),
    [kabupatenList]
  );

  const selectedKabNama = kabMap.get(kabupaten)?.nama ?? "";
  const selectedKomNama = komoditas;
  const kabNameByKode = (kode: string) => kabMap.get(kode)?.nama ?? "";

  const {
    avgPrice, highestInflation, cheapest, coverage,
    selectedKom, hargaAcuan, mostExpensive, ketimpangan, lowestDeflasi,
  } = useMemo(() => {
    const allEntries = Object.values(priceByKab);
    const withPrice = allEntries.filter(e => e.harga != null);
    const avgPrice = withPrice.length
      ? Math.round(withPrice.reduce((s, e) => s + (e.harga ?? 0), 0) / withPrice.length)
      : null;
    const highestInflation = allEntries.reduce<PriceEntry | null>((best, e) => {
      if (e.change_pct == null || e.change_pct <= 0) return best;
      if (!best || (best.change_pct ?? 0) < e.change_pct) return e;
      return best;
    }, null);
    const cheapest = withPrice.reduce<PriceEntry | null>((best, e) => {
      if (!best || (best.harga ?? Infinity) > (e.harga ?? Infinity)) return e;
      return best;
    }, null);
    const coverage = { withData: withPrice.length, total: kabupatenList.length };
    const selectedKom = komoditasList.find(k => k.nama === komoditas);
    const hargaAcuan = selectedKom?.harga_acuan ? Number(selectedKom.harga_acuan) : null;
    const mostExpensive = withPrice.reduce<PriceEntry | null>((best, e) => {
      if (!best || (best.harga ?? 0) < (e.harga ?? 0)) return e;
      return best;
    }, null);
    const ketimpangan = (mostExpensive?.harga != null && cheapest?.harga != null)
      ? mostExpensive.harga - cheapest.harga
      : null;
    const lowestDeflasi = withPrice
      .filter(e => e.change_pct != null && e.change_pct < 0)
      .reduce<PriceEntry | null>((best, e) => {
        if (!best || (e.change_pct ?? 0) < (best.change_pct ?? 0)) return e;
        return best;
      }, null);
    return { avgPrice, highestInflation, cheapest, coverage, selectedKom, hargaAcuan, mostExpensive, ketimpangan, lowestDeflasi };
  }, [priceByKab, komoditasList, komoditas, kabupatenList]);

  const komHighlight = (
    <span className={`font-semibold transition-colors duration-500 ${tableInView ? "text-[var(--brand-blue)]" : "text-steel"}`}>
      {selectedKomNama}
    </span>
  );
  const tableTitle = compareMode
    ? `Perbandingan: ${kabNameByKode(compareA) || "—"} vs ${kabNameByKode(compareB) || "—"}`
    : tableState?.mode === "kabupaten"
      ? `Harga Komoditas — ${selectedKabNama}`
      : tableState?.mode === "semua" && selectedKomNama
        ? <>Perbandingan Harga {komHighlight} — Semua Kabupaten/Kota</>
        : "Data Harga Komoditas";

  const sliderMax = periodOptions ? getSliderMax(mode, periodOptions) : 0;
  const periodLabel = periodOptions ? getPeriodLabel(mode, sliderIndex, periodOptions) : "";
  const [prevDateLabel, currentDateLabel] = periodOptions ? getDateLookup(mode, sliderIndex, periodOptions) : ['—', '—'];
  const [prevPeriodLabel, currentPeriodLabel] = periodOptions && appliedPeriod ? getDateLookup(mode, committedIndex, periodOptions) : ['Kemarin', 'Sekarang'];

  function handleExport() {
    console.info("Ekspor akan tersedia segera.");
  }

  return (
    <main className="flex flex-col min-h-screen lg:overflow-hidden bg-surface">
      <Navbar />
      <div className="w-full border-b bg-card px-4 sm:px-7 py-4 space-y-4 shrink-0 overflow-x-auto">

        {/* LCP anchor — large text from SSR data; browser picks this over the Leaflet tile */}
        <h1 className="text-xl font-bold text-[var(--brand-blue)] leading-tight">
          {komoditas || "Komoditas"}
          <span className="text-[var(--steel)] font-normal text-sm ml-2">
            {tipePasar === 3 ? "Pedagang Besar — Maluku" : "Pasar Tradisional — Maluku"}
          </span>
        </h1>

        {/* Row 1: Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-steel">
            <span>Provinsi Maluku</span>
            <ChevronRight className="h-3 w-3" />
            <button
              type="button"
              onClick={selectedKabNama || compareMode ? () => {
                setKabupaten("");
                setHoverSyncEnabled(true);
                requestAnimationFrame(() =>
                  mapRef.current?.flyTo([-5.3555, 129.5], 7, { animate: true, duration: 0.6 })
                );
                if (appliedPeriod) {
                  const rows = kabupatenList.map(
                    kab => priceByKab[kab.kode] ?? { kode: kab.kode, nama: kab.nama, harga: null, harga_terakhir: null, change_pct: null, is_up: null }
                  );
                  setTableState({ mode: "semua", rows });
                }
              } : undefined}
              className={selectedKabNama || compareMode ? "hover:text-ink focus-visible:outline-none focus-visible:underline" : "text-ink font-medium pointer-events-none"}
            >
              Pantau Harga
            </button>
            {selectedKabNama && !compareMode && (
              <>
                <ChevronRight className="h-3 w-3" />
                <span className="text-ink font-medium">{selectedKabNama}</span>
              </>
            )}
            {compareMode && (
              <>
                <ChevronRight className="h-3 w-3" />
                <button
                  type="button"
                  onClick={() => setCompareMode(false)}
                  className="text-ink font-medium hover:text-steel focus-visible:outline-none focus-visible:underline"
                >
                  Perbandingan: {kabNameByKode(compareA) || "Pilih A"} vs {kabNameByKode(compareB) || "Pilih B"}
                </button>
              </>
            )}
          </div>
          <div className="ml-auto pl-4 shrink-0 flex items-center gap-2">
            <span className="text-xs font-medium font-mono tabular-nums whitespace-nowrap text-ink">
              {periodOptions
                ? `${prevDateLabel} → ${currentDateLabel}`
                : <span className="inline-block h-4 w-32 bg-muted animate-pulse rounded align-middle" />}
            </span>
            <Clock className="h-4 w-4 text-steel shrink-0" />
          </div>
        </nav>

        {/* Row 2: Filter Ribbon */}
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

          {/* Periode */}
          <div className="space-y-1.5 shrink-0 w-32">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Periode</label>
            <Select value={mode} onValueChange={v => {
              const newMode = v as Mode;
              setMode(newMode);
              if (periodOptions) {
                const idx = findDefaultIndex(newMode, periodOptions);
                setSliderIndex(idx);
                setCommittedIndex(idx);
              }
            }}>
              <SelectTrigger className="h-9 w-full" aria-label="Tipe periode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MODES.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Timeline Slider */}
          <div className="space-y-1.5 flex-1 min-w-0 max-w-[260px]">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">
              Pilih Waktu{periodOptions && periodLabel ? ` (${periodLabel})` : ""}
            </label>
            <div className="flex items-center gap-2 border-b-2 p-1 rounded-md ">
              <Button
                variant="ghost" size="icon"
                aria-label="Periode sebelumnya"
                className="h-7 w-7 bg-background shadow-sm shrink-0"
                onClick={handlePrev}
                disabled={!periodOptions || sliderIndex <= 0}
              >
                <Minus className="h-4 w-4" />
              </Button>
              {periodOptions ? (
                <Slider
                  value={[sliderIndex]}
                  min={0}
                  max={sliderMax}
                  step={1}
                  aria-label={`Pilih periode: ${periodLabel ?? "waktu"}`}
                  onValueChange={(v) => {
                    const val = Array.isArray(v) ? v[0] : v;
                    setSliderIndex(val ?? 0);
                  }}
                  onValueCommit={(v) => {
                    const val = Array.isArray(v) ? v[0] : v;
                    setSliderIndex(val ?? 0);
                    setCommittedIndex(val ?? 0);
                  }}
                  className="grow"
                />
              ) : (
                <div className="grow h-4 bg-muted animate-pulse rounded" />
              )}
              <Button
                variant="ghost" size="icon"
                aria-label="Periode berikutnya"
                className="h-7 w-7 bg-background shadow-sm shrink-0"
                onClick={handleNext}
                disabled={!periodOptions || sliderIndex >= sliderMax}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Komoditas */}
          <div className="space-y-1.5 shrink-0 w-44">
            <label className="text-xs uppercase tracking-widest font-bold text-slate-500">Komoditas</label>
            <Select value={komoditas} onValueChange={v => setKomoditas(String(v))}>
              <SelectTrigger className="h-9 w-full" aria-label="Komoditas">
                <SelectValue placeholder="Pilih Komoditas" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {komoditasList.map(k => (
                    <SelectItem key={k.id} value={k.nama}>{k.nama}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Action buttons — horizontal, xs */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="xs"
              onClick={handleSubmit}
              disabled={!komoditas || !periodOptions}
              className="min-w-18 bg-(--brand-blue) hover:bg-(--brand-blue)/90 text-white"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Terapkan"}
            </Button>
            <Button
              size="xs"
              variant={compareMode ? "default" : "outline"}
              className="gap-1"
              onClick={toggleCompareMode}
            >
              <ArrowLeftRight className="h-3 w-3" />
              Bandingkan
            </Button>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-steel hover:text-ink transition-colors px-1"
            >
              Reset
            </button>
          </div>

          {/* Period date range — pushed to far right */}
        </div>
        {tipePasar === 3 && (
          <p className="text-xs text-amber-600">
            Data pedagang besar hanya tersedia untuk Kota Ambon dan Kota Tual. Wilayah lainnya ditampilkan tanpa data.
          </p>
        )}
      </div>

      <section className="flex items-center gap-4 px-7 pt-3 pb-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-pl-7">
        <KpiCard
          label="Harga Rata-rata"
          value={avgPrice != null ? formatPrice(avgPrice) : "—"}
          hint={selectedKomNama ? `untuk ${selectedKomNama}` : ""}
          definition="Rata-rata harga komoditas dari seluruh kabupaten/kota yang memiliki data pada periode ini."
          icon={<BarChart2 className="h-3.5 w-3.5" />}
          isLoading={isLoading || !appliedPeriod}
          fixedHeight={true}
        />
        <KpiCard
          label="Wilayah Termurah"
          value={cheapest?.harga != null ? formatPrice(cheapest.harga) : "—"}
          hint={cheapest?.nama ?? ""}
          definition="Kabupaten/kota dengan harga komoditas terendah pada periode ini."
          icon={<MapPin className="h-3.5 w-3.5" />}
          isLoading={isLoading || !appliedPeriod}
          fixedHeight={true}
        />
        <KpiCard
          label="Wilayah Termahal"
          value={mostExpensive?.harga != null ? formatPrice(mostExpensive.harga) : "—"}
          hint={mostExpensive?.nama ?? ""}
          definition="Kabupaten/kota dengan harga komoditas tertinggi pada periode ini."
          icon={<ArrowUp className="h-3.5 w-3.5" />}
          isLoading={isLoading || !appliedPeriod}
          fixedHeight={true}
        />
        <KpiCard
          label="Ketimpangan Harga"
          value={ketimpangan != null ? formatPrice(ketimpangan) : "—"}
          hint={ketimpangan != null ? `${cheapest?.nama ?? ""} ↔ ${mostExpensive?.nama ?? ""}` : ""}
          definition="Selisih antara harga tertinggi dan terendah antar wilayah — indikator disparitas harga."
          icon={<ArrowUpDown className="h-3.5 w-3.5" />}
          isLoading={isLoading || !appliedPeriod}
          fixedHeight={true}
        />
        <KpiCard
          label="Harga Acuan"
          value={hargaAcuan != null ? formatPrice(hargaAcuan) : "—"}
          hint={hargaAcuan != null && selectedKom ? `per ${selectedKom.satuan}` : "tidak tersedia"}
          definition="Harga eceran tertinggi atau harga acuan resmi pemerintah sebagai batas kewajaran harga komoditas ini."
          icon={<Tag className="h-3.5 w-3.5" />}
          isLoading={isLoading || !appliedPeriod}
          fixedHeight={true}
        />
        <KpiCard
          label="Inflasi Tertinggi"
          value={highestInflation?.change_pct != null ? `+${highestInflation.change_pct}%` : "—"}
          valueClass={highestInflation ? "text-red-600" : ""}
          hint={highestInflation ? `${highestInflation.nama} — ${appliedPeriod?.label ?? ""}` : "Tidak ada kenaikan"}
          definition="Wilayah dengan kenaikan harga terbesar dibanding periode sebelumnya."
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          isLoading={isLoading || !appliedPeriod}
          fixedHeight={true}
        />
        <KpiCard
          label="Deflasi Terendah"
          value={lowestDeflasi?.change_pct != null ? `${lowestDeflasi.change_pct}%` : "—"}
          valueClass={lowestDeflasi ? "text-emerald-600" : ""}
          hint={lowestDeflasi ? lowestDeflasi.nama : "Tidak ada penurunan"}
          definition="Wilayah dengan penurunan harga terbesar dibanding periode sebelumnya."
          icon={<TrendingDown className="h-3.5 w-3.5" />}
          isLoading={isLoading || !appliedPeriod}
          fixedHeight={true}
        />
        <KpiCard
          label="Cakupan Data"
          value={`${coverage.withData}/${coverage.total}`}
          hint="kabupaten melapor"
          definition="Jumlah kabupaten/kota yang memiliki data harga pada periode ini dibanding total wilayah."
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          isLoading={isLoading || !appliedPeriod}
          fixedHeight={true}
        />
      </section>

      <div className="flex p-3 pt-0 overflow-auto flex-col min-h-[600px]">
        <section className="flex-1 p-4 overflow-hidden min-h-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 min-h-0" ref={mapCardRef}>
              <Card className="gap-0 py-2">
                <CardHeader className="py-3 px-4 shrink-0">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 shrink-0" />
                    Peta Maluku — Pantau Harga
                    {selectedKomNama && (
                      <span className={`font-semibold truncate transition-colors duration-500 ${mapCardInView ? "text-[var(--brand-blue)]" : "text-steel"}`}>
                        ({selectedKomNama})
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-full p-2 relative">
                  {isLoading && (
                    <div className="absolute inset-0 z-[500] bg-background/50 animate-pulse rounded pointer-events-none" />
                  )}
                  <div className="h-[280px] sm:h-[380px] lg:h-[508px] relative">
                    {isMounted ? (
                      <Suspense fallback={<MapFallback text="Memuat peta..." />}>
                        {geoJsonData ? (
                          <MapChoropleth
                            geoJsonData={geoJsonData}
                            onEachFeature={onEachFeature}
                            styleFeature={styleFeature}
                            mapKey={`${komoditas}-${appliedPeriod?.label ?? ""}`}
                            onMapReady={(map) => { mapRef.current = map; }}
                          />
                        ) : (
                          <MapFallback text="Memuat data peta..." />
                        )}
                      </Suspense>
                    ) : (
                      <MapFallback text="Memuat peta..." />
                    )}
                    {appliedPeriod && hasData && (
                      <MapLegend />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-1 min-h-0">
              <KabupatenPanel
                kabupatenList={kabupatenList}
                priceByKab={priceByKab}
                selectedKabupaten={kabupaten}
                onKabupatenClick={handleKabupatenClick}
                compareMode={compareMode}
                compareA={compareA}
                compareB={compareB}
                onCompareClear={(slot) => {
                  if (slot === "a") setCompareA("");
                  else setCompareB("");
                }}
                isLoading={isLoading}
                hoveredKabupaten={hoveredKabupaten}
                onKabupatenHover={(kode) => {
                  hoverSourceRef.current = kode ? 'sidebar' : null;
                  setHoveredKabupaten(kode);
                }}
                hoverSyncEnabled={hoverSyncEnabled}
                onToggleHoverSync={() => setHoverSyncEnabled(v => !v)}
                onResetMap={() => requestAnimationFrame(() => mapRef.current?.flyTo([-5.3555, 129.5], 6, { animate: true, duration: 0.6 }))}
                onZoomIn={() => mapRef.current?.zoomIn()}
                onZoomOut={() => mapRef.current?.zoomOut()}
              />
            </div>
          </div>
        </section>

        <section ref={compTableRef} className="px-4 pb-4 pt-2 shrink-0">
          <Card>
            <CardHeader className="px-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <ShoppingBasket className="h-4 w-4 shrink-0" />
                {tableTitle}
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExport}
                disabled={!appliedPeriod}
                title="Ekspor data (segera tersedia)"
              >
                <Download className="h-3.5 w-3.5" />
                Ekspor
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                {compareMode ? (
                  <ComparisonTable
                    a={compareRows.a}
                    b={compareRows.b}
                    aName={kabNameByKode(compareA) || "A"}
                    bName={kabNameByKode(compareB) || "B"}
                    bothPicked={!!compareA && !!compareB}
                  />
                ) : (
                  <table className="w-full text-sm">
                    {tableState?.mode === "semua" ? (
                      <>
                        <thead>
                          <tr className="border-b border-hairline bg-muted/50">
                            <th className="text-left px-4 py-2 font-medium text-ink">Kabupaten/Kota</th>
                            <th className="text-right px-4 py-2 font-medium text-ink">{prevPeriodLabel}</th>
                            <th className="text-right px-4 py-2 font-medium text-ink">{currentPeriodLabel}</th>
                            <th className="text-right px-4 py-2 font-medium text-ink">Inflasi/Deflasi</th>
                            <th className="text-right px-4 py-2 font-medium text-ink">Perubahan</th>
                            <th className="text-center px-4 py-2 font-medium text-ink">Tren</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableState.rows.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-6 text-center text-steel">Tidak ada data untuk periode ini</td></tr>
                          ) : tableState.rows.map(row => (
                            <tr
                              key={row.kode}
                              className="border-b border-hairline hover:bg-muted/30 cursor-pointer"
                              onClick={() => handleKabupatenClick(row.kode)}
                            >
                              <td className="px-4 py-2 font-medium text-ink">{row.nama}</td>
                              <td className="px-4 py-2 text-right text-steel tabular-nums">{formatPrice(row.harga_terakhir)}</td>
                              <td className="px-4 py-2 text-right text-ink tabular-nums">{row.harga != null ? formatPrice(row.harga) : <span className="text-steel italic">Tidak tersedia</span>}</td>
                              <td className="px-4 py-2 text-right tabular-nums"><PriceDiff current={row.harga} previous={row.harga_terakhir} /></td>
                              <td className="px-4 py-2 text-right tabular-nums"><ChangeBadge pct={row.change_pct} /></td>
                              <td className="px-4 py-2 text-center">
                                <TrendIcon changePct={row.change_pct} hasHistory={row.harga_terakhir != null} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    ) : tableState?.mode === "kabupaten" ? (
                      <>
                        <thead>
                          <tr className="border-b border-hairline bg-muted/50">
                            <th className="text-left px-4 py-2 font-medium text-ink">Komoditas</th>
                            <th className="text-left px-4 py-2 font-medium text-ink">Satuan</th>
                            <th className="text-right px-4 py-2 font-medium text-ink">{prevPeriodLabel}</th>
                            <th className="text-right px-4 py-2 font-medium text-ink">{currentPeriodLabel}</th>
                            <th className="text-right px-4 py-2 font-medium text-ink">Selisih</th>
                            <th className="text-right px-4 py-2 font-medium text-ink">Perubahan</th>
                            <th className="text-center px-4 py-2 font-medium text-ink">Tren</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableState.rows.length === 0 ? (
                            <tr><td colSpan={7} className="px-4 py-6 text-center text-steel">Tidak ada data untuk periode ini</td></tr>
                          ) : tableState.rows.map(item => (
                            <tr key={item.id} className="border-b border-hairline hover:bg-muted/30">
                              <td className="px-4 py-2 font-medium text-ink">{item.nama}</td>
                              <td className="px-4 py-2 text-steel">{item.satuan}</td>
                              <td className="px-4 py-2 text-right text-steel tabular-nums">{formatPrice(item.harga_terakhir)}</td>
                              <td className="px-4 py-2 text-right text-ink tabular-nums">{formatPrice(item.harga)}</td>
                              <td className="px-4 py-2 text-right tabular-nums"><PriceDiff current={item.harga} previous={item.harga_terakhir} /></td>
                              <td className="px-4 py-2 text-right tabular-nums"><ChangeBadge pct={item.change_pct} /></td>
                              <td className="px-4 py-2 text-center">
                                <TrendIcon changePct={item.change_pct} hasHistory={item.harga_terakhir != null} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </>
                    ) : (
                      <tbody>
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-steel">
                            {!appliedPeriod
                              ? "Pilih komoditas dan periode waktu, lalu tekan Terapkan"
                              : "Klik kabupaten pada peta atau daftar untuk melihat detail harga"}
                          </td>
                        </tr>
                      </tbody>
                    )}
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
      <DataSourceFooter sources={tipePasar === 1 ? ["sp2kp"] : ["pihps"]} />
    </main>
  );
}

function MapFallback({ text }: { text: string }) {
  return (
    <div className="w-full h-full relative overflow-hidden rounded-lg bg-[#c8dae4] dark:bg-[#0e1e32]">
      {/* Inline SVG grid — renders instantly, zero external requests, not an LCP candidate */}
      <svg className="absolute inset-0 w-full h-full opacity-20 dark:opacity-10" aria-hidden="true">
        <defs>
          <pattern id="map-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#map-grid)" />
      </svg>
      <div className="absolute inset-0 flex items-end justify-start p-3">
        <span className="bg-background/85 rounded px-2 py-1 text-xs text-[var(--ink)] flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-blue)] animate-pulse inline-block" />
          {text}
        </span>
      </div>
    </div>
  );
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-steel">–</span>;
  return (
    <span className={pct > 0 ? "text-red-600" : pct < 0 ? "text-green-700" : "text-steel"}>
      {pct > 0 ? "+" : ""}{pct}%
    </span>
  );
}

function TrendIcon({ changePct, hasHistory }: { changePct: number | null; hasHistory: boolean }) {
  if (!hasHistory || changePct == null) return <span className="text-steel">–</span>;
  if (changePct === 0) return <Minus className="h-4 w-4 text-steel mx-auto" aria-label="Tidak ada perubahan" />;
  return changePct > 0
    ? <TrendingUp className="h-4 w-4 text-red-600 mx-auto" aria-label="Naik" />
    : <TrendingDown className="h-4 w-4 text-green-700 mx-auto" aria-label="Turun" />;
}

function PriceDiff({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return <span className="text-steel">\u2013</span>;
  const diff = current - previous;
  if (diff === 0) return <span className="text-steel">Rp 0</span>;
  const sign = diff > 0 ? "+" : "\u2212";
  return (
    <span className={diff > 0 ? "text-red-600" : "text-green-700"}>
      {sign}Rp {Math.abs(diff).toLocaleString("id-ID")}
    </span>
  );
}

function MapLegend() {
  return (
    <div className="absolute bottom-3 left-3 z-[400] bg-card/90 backdrop-blur-md border border-hairline rounded-xl shadow-sm p-3 w-[244px]">
      <div className="text-[11px] uppercase tracking-wide text-steel font-medium mb-1.5">Perubahan Harga</div>
      <div className="h-4 w-full rounded overflow-hidden flex">
        {CHANGE_BANDS.map(b => (
          <div key={b.color} className="flex-1" style={{ background: b.color }} title={b.desc} />
        ))}
      </div>
      <div className="flex mt-1 text-xs font-medium text-ink tabular-nums">
        {CHANGE_BANDS.map(b => (
          <div key={b.label} className="flex-1 text-center">{b.label}</div>
        ))}
      </div>
      <div className="flex mt-0.5 text-[9px] text-steel/70 tabular-nums">
        {CHANGE_BANDS.map(b => (
          <div key={b.desc} className="flex-1 text-center">{b.desc}</div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 text-xs text-steel">
        <span className="inline-block h-2 w-2 rounded-sm border border-dashed border-steel/70 bg-[#E2E8F0] dark:bg-zinc-700" />
        <span>data tidak tersedia</span>
      </div>
    </div>
  );
}

function ComparisonTable({ a, b, aName, bName, bothPicked }: { a: TableRow[]; b: TableRow[]; aName: string; bName: string; bothPicked: boolean }) {
  if (!bothPicked) {
    return (
      <div className="px-4 py-8 text-center text-sm text-steel">
        Pilih dua kabupaten/kota pada panel sebelah untuk melihat perbandingan.
      </div>
    );
  }
  const map = new Map<number, { nama: string; satuan: string; a: TableRow | null; b: TableRow | null }>();
  for (const r of a) map.set(r.id, { nama: r.nama, satuan: r.satuan, a: r, b: null });
  for (const r of b) {
    const existing = map.get(r.id);
    if (existing) existing.b = r;
    else map.set(r.id, { nama: r.nama, satuan: r.satuan, a: null, b: r });
  }
  const rows = Array.from(map.values());
  if (rows.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-steel">Tidak ada data komoditas untuk periode ini</div>;
  }

  function diff(av: number | null | undefined, bv: number | null | undefined): string {
    if (av == null || bv == null) return "–";
    const d = av - bv;
    if (d === 0) return "Rp 0";
    const sign = d > 0 ? "+" : "−";
    return `${sign} Rp ${Math.abs(d).toLocaleString("id-ID")}`;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-hairline bg-muted/50">
          <th className="text-left px-4 py-2 font-medium text-ink">Komoditas</th>
          <th className="text-left px-4 py-2 font-medium text-ink">Satuan</th>
          <th className="text-right px-4 py-2 font-medium text-ink">{aName} (Rp)</th>
          <th className="text-right px-4 py-2 font-medium text-ink">{bName} (Rp)</th>
          <th className="text-right px-4 py-2 font-medium text-ink">Selisih (A − B)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.nama} className="border-b border-hairline hover:bg-muted/30">
            <td className="px-4 py-2 font-medium text-ink">{row.nama}</td>
            <td className="px-4 py-2 text-steel">{row.satuan}</td>
            <td className="px-4 py-2 text-right text-ink tabular-nums">{row.a ? formatPrice(row.a.harga) : <span className="text-steel italic">—</span>}</td>
            <td className="px-4 py-2 text-right text-ink tabular-nums">{row.b ? formatPrice(row.b.harga) : <span className="text-steel italic">—</span>}</td>
            <td className="px-4 py-2 text-right tabular-nums text-ink">{diff(row.a?.harga, row.b?.harga)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
