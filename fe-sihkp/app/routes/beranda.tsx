import type { Route } from "./+types/beranda";
import { useState } from "react";
import { Link } from "react-router";
import { Store, Map, BarChart2, Building2, MapPin, TrendingUp, BrainCircuit, ArrowRight, Warehouse, Database, Layers, ExternalLink, Mail, Users } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Navbar } from "~/components/layout/Navbar";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" },
];

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Beranda - Sistem Informasi Harga Komoditas" },
    { name: "description", content: "Platform informasi harga komoditas di pasar modern dan tradisional Provinsi Maluku" },
  ];
}

const KAB_NAMES: Record<string, string> = {
  "8171": "Kota Ambon",
  "8172": "Kota Tual",
  "8101": "Kab. Maluku Tengah",
  "8102": "Kab. Maluku Tenggara",
  "8103": "Kab. Kepulauan Tanimbar",
  "8104": "Kab. Buru",
  "8105": "Kab. Seram Bagian Timur",
  "8106": "Kab. Seram Bagian Barat",
  "8107": "Kab. Kepulauan Aru",
  "8108": "Kab. Maluku Barat Daya",
  "8109": "Kab. Buru Selatan",
};

const PASAR_LIST = [
  { id: 679,  nama: "Pasar Mardika",            kode_kab_kota: "8171" },
  { id: 682,  nama: "Pasar Maren",              kode_kab_kota: "8172" },
  { id: 668,  nama: "Pasar Binaya Masohi",      kode_kab_kota: "8101" },
  { id: 669,  nama: "Pasar Langgur",            kode_kab_kota: "8102" },
  { id: 670,  nama: "Pasar Omele Sifnana",      kode_kab_kota: "8103" },
  { id: 72,   nama: "Pasar Rakyat Namlea",      kode_kab_kota: "8104" },
  { id: 671,  nama: "Pasar Rakyat Gumumai",     kode_kab_kota: "8105" },
  { id: 672,  nama: "Pasar Rakyat Kota Piru",   kode_kab_kota: "8106" },
  { id: 1348, nama: "Pasar Agropolitan Waimital", kode_kab_kota: "8106" },
  { id: 673,  nama: "Pasar Jargaria",           kode_kab_kota: "8107" },
  { id: 675,  nama: "Pasar Kalwedo",            kode_kab_kota: "8108" },
  { id: 677,  nama: "Pasar Namrole",            kode_kab_kota: "8109" },
];

interface HeroStat {
  Icon: React.ElementType;
  value: string;
  label: string;
  sub: string;
  breakdown?: string[];
}

const HERO_STATS: HeroStat[] = [
  {
    Icon: Store,
    value: "46",
    label: "Pasar Pantauan",
    sub: "Tersebar di Provinsi Maluku",
    breakdown: ["12 Pasar Tradisional", "34 Pedagang Besar"],
  },
  { Icon: Map,       value: "11",  label: "Kabupaten/Kota",      sub: "Di Provinsi Maluku" },
  { Icon: BarChart2, value: "30+", label: "Komoditas Terpantau", sub: "Harga & Prediksi Tersedia" },
];

const PASAR_GROSIR: { id: number; nama: string; kode_kab: string }[] = [
  // Kota Ambon — 28 pedagang
  { id: 260,  nama: "Albagir",             kode_kab: "8171" },
  { id: 3218, nama: "Ambon Manise",        kode_kab: "8171" },
  { id: 3219, nama: "Bapak Allan",         kode_kab: "8171" },
  { id: 262,  nama: "Bapak Hakim",         kode_kab: "8171" },
  { id: 258,  nama: "Bpk Abba / Ibu Jaya", kode_kab: "8171" },
  { id: 264,  nama: "Bpk Alan",            kode_kab: "8171" },
  { id: 3216, nama: "CV Berkat Mulia",     kode_kab: "8171" },
  { id: 265,  nama: "CV Karya Indo",       kode_kab: "8171" },
  { id: 236,  nama: "Firma Bandil",        kode_kab: "8171" },
  { id: 273,  nama: "Ibu Hartati",         kode_kab: "8171" },
  { id: 3220, nama: "Perkasa Raya",        kode_kab: "8171" },
  { id: 3217, nama: "Toko Colin",          kode_kab: "8171" },
  { id: 3215, nama: "Toko Harapan Baru",   kode_kab: "8171" },
  { id: 397,  nama: "Toko Indojaya",       kode_kab: "8171" },
  { id: 385,  nama: "Toko Lima Satu",      kode_kab: "8171" },
  { id: 382,  nama: "Toko Manise",         kode_kab: "8171" },
  { id: 398,  nama: "Toko Morikana",       kode_kab: "8171" },
  { id: 381,  nama: "Toko Planet",         kode_kab: "8171" },
  { id: 399,  nama: "Toko Sedap Malam",    kode_kab: "8171" },
  { id: 3222, nama: "Toko Sobat Kita",     kode_kab: "8171" },
  { id: 396,  nama: "Toko Sumber Mujur",   kode_kab: "8171" },
  { id: 2785, nama: "Toko TLS",            kode_kab: "8171" },
  { id: 3221, nama: "Tri Samudra",         kode_kab: "8171" },
  { id: 261,  nama: "Tunas Baru",          kode_kab: "8171" },
  { id: 2776, nama: "UD HJN",              kode_kab: "8171" },
  { id: 263,  nama: "UD Jaya Makmur",      kode_kab: "8171" },
  { id: 257,  nama: "UD Melaty",           kode_kab: "8171" },
  { id: 2784, nama: "Udin Tahsa",          kode_kab: "8171" },
  // Kota Tual — 6 pedagang
  { id: 271,  nama: "Abang Anca",          kode_kab: "8172" },
  { id: 269,  nama: "Abang Raman",         kode_kab: "8172" },
  { id: 267,  nama: "Hanafi",              kode_kab: "8172" },
  { id: 270,  nama: "Sumber Jaya",         kode_kab: "8172" },
  { id: 268,  nama: "Toko Haji Taba",      kode_kab: "8172" },
  { id: 266,  nama: "Toko Harapan Jaya",   kode_kab: "8172" },
];

const FEATURES = [
  {
    to: "/pantau-harga",
    colorVar: "--feature-blue-rgb",
    Icon: MapPin,
    title: "PANTAU HARGA",
    tagline: "Eksplorasi sebaran harga di seluruh Maluku melalui peta tematik interaktif yang diperbarui setiap hari.",
    screenshot: "/pages/pantau_harga.webp",
    badge: null,
  },
  {
    to: "/analisis-harga",
    colorVar: "--feature-orange-rgb",
    Icon: TrendingUp,
    title: "ANALISIS HARGA",
    tagline: "Bandingkan harga antar pasar dan temukan anomali distribusi melalui visualisasi data yang mendalam.",
    screenshot: "/pages/analisis_harga.webp",
    badge: null,
  },
  {
    to: "/prediksi",
    colorVar: "--feature-purple-rgb",
    Icon: BrainCircuit,
    title: "PREDIKSI HARGA",
    tagline: "Antisipasi fluktuasi pasar dengan proyeksi harga berbasis AI untuk persiapan langkah strategis.",
    screenshot: "/pages/prediksi.webp",
    badge: "AI · Beta",
  },
];

export default function Beranda() {
  const [dirTab, setDirTab] = useState<"tradisional" | "grosir">("tradisional");
  const currentYear = new Date().getFullYear();

  return (
    <main className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section
        className="relative overflow-hidden bg-[var(--brand-blue)] dark:bg-[#0b1564]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.10) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      >
        <div className="pointer-events-none absolute -top-32 -left-32 h-[28rem] w-[28rem] rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-white/10 blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Left */}
            <div className="space-y-6">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 backdrop-blur-sm text-white text-xs font-medium px-3 py-1">
                <MapPin className="h-3 w-3" />
                Provinsi Maluku
              </span>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight tracking-tight">
                Pantau Disparitas, Kendalikan Stabilitas Pangan.
              </h1>
              <p className="text-base sm:text-lg text-white/85 leading-relaxed max-w-xl">
                Platform analitik komoditas terpadu yang memetakan fluktuasi harga di 11 Kabupaten/Kota. Pahami tren pasar lintas pulau melalui visualisasi data spasial yang komprehensif.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link
                  to="/pantau-harga"
                  className="inline-flex items-center gap-2 rounded-full bg-white text-[var(--brand-blue)] text-sm font-semibold px-5 py-2.5 hover:bg-white/90 transition-colors"
                >
                  Pantau Harga
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/analisis-harga"
                  className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur-sm border border-white/20 text-white text-sm font-semibold px-5 py-2.5 hover:bg-white/25 transition-colors"
                >
                  Analisis Harga
                </Link>
              </div>
            </div>

            {/* Right — frosted stat pills */}
            <div className="flex justify-center lg:justify-end">
              <div className="flex flex-col gap-3 w-full max-w-xs">
                {HERO_STATS.map(({ Icon, value, label, sub, breakdown }) => (
                  <div
                    key={label}
                    className="flex items-center gap-4 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 px-5 py-4"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-white tabular-nums leading-none">{value}</div>
                      {breakdown ? (
                        <>
                          <div className="text-xs text-white/70 mt-0.5">{label}</div>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {breakdown.map(b => (
                              <span key={b} className="text-[10px] font-medium bg-white/20 rounded-full px-2 py-0.5 text-white/90 leading-4">
                                {b}
                              </span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-white/70 mt-0.5">{label} — {sub}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="py-14 sm:py-16 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--ink)]">Fitur Unggulan</h2>
            <p className="text-sm text-[var(--steel)] mt-1.5">
              Eksplorasi data harga komoditas Maluku dengan berbagai sudut pandang
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {FEATURES.map(({ to, colorVar, Icon, title, tagline, screenshot, badge }) => (
              <Link
                key={to}
                to={to}
                className="group relative block rounded-[28px] overflow-hidden h-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                {/* Full-bleed screenshot */}
                <img
                  src={screenshot}
                  alt={`Preview halaman ${title}`}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                />

                {/* Brand gradient: opaque at bottom → transparent at top. Uses CSS variables so dark mode adjusts automatically. */}
                <div
                  className="absolute inset-0"
                  style={{
                    background: `linear-gradient(to top, rgb(var(${colorVar})) 0%, rgb(var(${colorVar}) / 0.80) 30%, rgb(var(${colorVar}) / 0.27) 60%, transparent 85%)`,
                  }}
                />

                {/* Content anchored to bottom */}
                <div className="absolute bottom-0 inset-x-0 p-6">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex items-center gap-2">
                      {badge && (
                        <span className="text-[10px] font-semibold tracking-wide rounded-full bg-white/20 backdrop-blur-sm px-2 py-0.5 text-white/90">
                          {badge}
                        </span>
                      )}
                      <ArrowRight className="h-4 w-4 text-white/50 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-300" />
                    </div>
                  </div>
                  <h3 className="text-base font-bold tracking-wide text-white">{title}</h3>
                  <p className="text-sm text-white/75 mt-1 leading-relaxed">{tagline}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Metodologi */}
      <section className="py-20 sm:py-24 bg-surface border-t border-[var(--hairline)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <div className="mb-12 max-w-2xl">
            <span className="text-xs font-bold tracking-widest uppercase text-[var(--brand-blue)]">Metodologi</span>
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--ink)] mt-2">Bagaimana Platform Ini Bekerja</h2>
            <p className="text-sm text-[var(--steel)] mt-2 leading-relaxed">
              Transparansi adalah fondasi platform ini. Berikut penjelasan mengenai cara kami mengumpulkan, memproses, dan menganalisis data harga komoditas Maluku.
            </p>
          </div>

          <div className="space-y-16">

            {/* 01 — Sumber Data */}
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 lg:gap-16 items-start">
              <div>
                <span className="text-[88px] font-black leading-none text-[var(--ink)]/[0.04] select-none block">01</span>
                <div className="flex items-center gap-3 -mt-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950">
                    <Database className="h-5 w-5 text-[var(--brand-blue)]" />
                  </div>
                  <h3 className="text-base font-bold text-[var(--ink)]">Sumber Data</h3>
                </div>
              </div>
              <div className="space-y-4">
                <p className="text-sm text-[var(--steel)] leading-relaxed">
                  Kami mengumpulkan data harga komoditas pangan dari dua sumber resmi pemerintah yang saling melengkapi — pasar tradisional dan pasar grosir.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href="https://sp2kp.kemendag.go.id/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-3 rounded-xl border border-[var(--hairline)] bg-[var(--canvas)] px-4 py-3 hover:border-[var(--brand-blue)]/40 transition-colors"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950 mt-0.5">
                      <Store className="h-4 w-4 text-[var(--brand-blue)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-[var(--ink)]">SP2KP</div>
                      <div className="text-xs text-[var(--steel)]">Kementerian Perdagangan</div>
                      <div className="text-[10px] text-[var(--steel)]/60 mt-0.5">Pasar Tradisional · 11 Kabupaten/Kota</div>
                    </div>
                    <ExternalLink className="h-3 w-3 text-[var(--steel)]/30 group-hover:text-[var(--brand-blue)] shrink-0 mt-0.5 transition-colors" />
                  </a>
                  <a
                    href="https://www.bi.go.id/hargapangan/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-3 rounded-xl border border-[var(--hairline)] bg-[var(--canvas)] px-4 py-3 hover:border-amber-400/40 transition-colors"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/60 mt-0.5">
                      <Warehouse className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-[var(--ink)]">PIHPS</div>
                      <div className="text-xs text-[var(--steel)]">Bank Indonesia</div>
                      <div className="text-[10px] text-[var(--steel)]/60 mt-0.5">Pedagang Besar · Kota Ambon &amp; Tual</div>
                    </div>
                    <ExternalLink className="h-3 w-3 text-[var(--steel)]/30 group-hover:text-amber-500 shrink-0 mt-0.5 transition-colors" />
                  </a>
                </div>
                <Link
                  to="/pantau-harga"
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-blue)] text-white text-xs font-semibold px-4 py-2 hover:opacity-90 transition-opacity"
                >
                  Pantau Harga Sekarang <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            <div className="border-t border-[var(--hairline)]" />

            {/* 02 — Penanganan & Agregasi Data */}
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 lg:gap-16 items-start">
              <div>
                <span className="text-[88px] font-black leading-none text-[var(--ink)]/[0.04] select-none block">02</span>
                <div className="flex items-center gap-3 -mt-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/60">
                    <Layers className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <h3 className="text-base font-bold text-[var(--ink)]">Penanganan &amp; Agregasi Data</h3>
                </div>
              </div>
              <div className="space-y-4">
                <p className="text-sm text-[var(--steel)] leading-relaxed">
                  Tantangan utama yang kami hadapi adalah <em>missing data</em> — kekosongan pencatatan yang kerap terjadi pada sistem SP2KP dan PIHPS. Untuk mengatasinya, kami menerapkan strategi{" "}
                  <span className="inline-flex items-center rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 text-[11px] font-mono font-semibold px-1.5 py-0.5 align-middle">LOCF</span>{" "}
                  <span className="text-xs text-[var(--steel)]/70">(Last Observation Carried Forward)</span> — nilai harga terakhir yang diketahui dibawa maju untuk mengisi periode yang kosong.
                </p>
                <p className="text-sm text-[var(--steel)] leading-relaxed">
                  Selanjutnya, harga harian diagregasi menggunakan pendekatan{" "}
                  <span className="inline-flex items-center rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 text-[var(--brand-blue)] text-[11px] font-mono font-semibold px-1.5 py-0.5 align-middle">LKV</span>{" "}
                  <span className="text-xs text-[var(--steel)]/70">(Last Known Value pada akhir periode)</span> ke dalam empat granularitas waktu:
                </p>
                <div className="flex flex-wrap gap-2">
                  {["Mingguan", "Bulanan", "Kuartalan", "Semesteran"].map(p => (
                    <span key={p} className="text-xs font-medium rounded-full border border-[var(--hairline)] bg-[var(--canvas)] px-3 py-1 text-[var(--steel)]">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--hairline)]" />

            {/* 03 — Model Prediksi */}
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 lg:gap-16 items-start">
              <div>
                <span className="text-[88px] font-black leading-none text-[var(--ink)]/[0.04] select-none block">03</span>
                <div className="flex items-center gap-3 -mt-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950/60">
                    <BrainCircuit className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <h3 className="text-base font-bold text-[var(--ink)]">Model Prediksi Harga</h3>
                </div>
              </div>
              <div className="space-y-4">
                <p className="text-sm text-[var(--steel)] leading-relaxed">
                  Model prediksi kami menggunakan{" "}
                  <span className="inline-flex items-center rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[11px] font-mono font-semibold px-1.5 py-0.5 align-middle">XGBoost</span>{" "}
                  dengan pendekatan{" "}
                  <span className="inline-flex items-center rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[11px] font-mono font-semibold px-1.5 py-0.5 align-middle">walk-forward</span>{" "}
                  <span className="text-xs text-[var(--steel)]/70">time series</span>. Fitur lag dari masing-masing komoditas per kabupaten dikombinasikan dengan data harga komoditas pada periode yang sama dari Kota Ambon sebagai referensi silang.
                </p>
                <div className="flex items-start gap-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 px-4 py-3">
                  <MapPin className="h-4 w-4 text-[var(--brand-blue)] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-[var(--ink)]">Kota Ambon sebagai Pusat Kegiatan Nasional (PKN)</div>
                    <p className="text-xs text-[var(--steel)] mt-0.5 leading-relaxed">
                      Ambon berfungsi sebagai simpul logistik dan pintu gerbang distribusi utama bagi seluruh wilayah kepulauan Maluku, menjadikannya referensi harga yang signifikan secara spasial.{" "}
                      <span className="text-[var(--steel)]/50">Perda Provinsi Maluku No. 1 Tahun 2013 tentang RTRW Provinsi Maluku 2013–2033.</span>
                    </p>
                  </div>
                </div>
                <p className="text-xs text-[var(--steel)]/60 leading-relaxed">
                  <span className="font-semibold text-[var(--steel)]/80 not-italic">Keterbatasan model:</span>{" "}
                  Faktor eksternal seperti kondisi cuaca dan biaya logistik belum dimasukkan — mengingat Maluku adalah wilayah kepulauan yang sangat bergantung pada jalur laut. Hal ini merupakan peluang pengembangan untuk penelitian selanjutnya.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Pasar directory */}
      <section className="py-20 sm:py-24 bg-surface">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-[var(--ink)]">Direktori Pasar Pantauan</h2>
              <p className="text-sm text-[var(--steel)] mt-1.5">
                {dirTab === "tradisional"
                  ? "12 pasar rakyat aktif di 11 Kabupaten/Kota Provinsi Maluku"
                  : "34 pedagang besar di Kota Ambon dan Kota Tual"}
              </p>
            </div>

            {/* Tab switcher */}
            <div className="inline-flex rounded-xl border border-hairline bg-muted p-1 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setDirTab("tradisional")}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  dirTab === "tradisional"
                    ? "bg-[var(--brand-blue)] text-white shadow-sm"
                    : "text-steel hover:text-ink"
                }`}
              >
                <Building2 className="h-3.5 w-3.5" />
                Pasar Tradisional
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 leading-none font-semibold ${dirTab === "tradisional" ? "bg-white/20 text-white" : "bg-muted-foreground/20 text-steel"}`}>12</span>
              </button>
              <button
                type="button"
                onClick={() => setDirTab("grosir")}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  dirTab === "grosir"
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-steel hover:text-ink"
                }`}
              >
                <Warehouse className="h-3.5 w-3.5" />
                Pedagang Besar
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 leading-none font-semibold ${dirTab === "grosir" ? "bg-white/20 text-white" : "bg-muted-foreground/20 text-steel"}`}>34</span>
              </button>
            </div>
          </div>

          {dirTab === "tradisional" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {PASAR_LIST.map((p) => (
                <Card key={p.id} className="border border-hairline bg-canvas">
                  <CardContent className="px-4 py-4 flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950 mt-0.5">
                      <Building2 className="h-4 w-4 text-[var(--brand-blue)]" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--ink)] leading-snug">{p.nama.trim()}</div>
                      <div className="text-xs text-[var(--steel)] mt-0.5">{KAB_NAMES[p.kode_kab_kota]}</div>
                      <Badge variant="outline" className="mt-2 text-[10px] px-1.5 py-0 h-4">Pasar Rakyat</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {(["8171", "8172"] as const).map(kode => {
                const kotaNama = KAB_NAMES[kode];
                const pasarKota = PASAR_GROSIR.filter(p => p.kode_kab === kode);
                return (
                  <div key={kode}>
                    <div className="flex items-center gap-2 mb-3">
                      <MapPin className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-sm font-semibold text-[var(--ink)]">{kotaNama}</span>
                      <span className="text-xs text-[var(--steel)]">— {pasarKota.length} pedagang</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {pasarKota.map((p) => (
                        <Card key={p.id} className="border border-amber-100 dark:border-amber-900/40 bg-canvas">
                          <CardContent className="px-4 py-4 flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/60 mt-0.5">
                              <Warehouse className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[var(--ink)] leading-snug">{p.nama}</div>
                              <div className="text-xs text-[var(--steel)] mt-0.5">{kotaNama}</div>
                              <Badge className="mt-2 text-[10px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800">
                                Pedagang Besar
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
      {/* Footer */}
      <footer className="border-t border-[var(--hairline)] bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">

            {/* Left — slogan */}
            <p className="text-xl font-semibold select-none text-[var(--ink)] opacity-70 leading-tight">
              Data Driven Development<br />
              <span className="text-base font-normal text-[var(--steel)]">for better Maluku&nbsp;♥️</span>
            </p>

            {/* Right — meta stack */}
            <div className="flex flex-col gap-1.5 text-xs text-[var(--steel)] sm:items-end">
              <span>© {currentYear} Sistem Informasi Harga Komoditas Maluku</span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3 w-3 shrink-0" />
                Presented by{" "}
                <span className="font-semibold text-[var(--ink)]">bismillah cepat lulus</span>
              </span>
              <a
                href="mailto:ardiansyahrukua07@gmail.com"
                className="inline-flex items-center gap-1.5 hover:text-[var(--ink)] transition-colors"
              >
                <Mail className="h-3 w-3 shrink-0" />
                ardiansyahrukua07@gmail.com
              </a>
            </div>

          </div>
        </div>
      </footer>
    </main>
  );
}
