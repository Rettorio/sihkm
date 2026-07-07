# SIHKM Frontend — React SPA

Frontend application for Sistem Informasi Harga Komoditas Maluku (SIHKM). Built with React, TypeScript, React Router v7, and shadcn/ui. Provides a geospatial dashboard for monitoring and forecasting food commodity prices across 11 regencies of Maluku.

## Tech Stack

- **Framework:** React 19 + Vite
- **Language:** TypeScript
- **Routing:** React Router v7 (file-based via `routes.ts`)
- **Styling:** Tailwind CSS + class-variance-authority
- **UI Components:** shadcn/ui (radix-ui primitives)
- **Icons:** Lucide React + Phosphor Icons
- **Maps:** Leaflet / React-Leaflet
- **Caching:** Dexie (IndexedDB wrapper)
- **Server:** Hono (via react-router-hono-server)
- **Fonts:** Geist (display), Inter (UI), JetBrains Mono (code)

## Project Structure

```
app/
├── components/
│   ├── layout/              # Shell, sidebar, navbar
│   ├── ui/                  # shadcn/ui primitives (Button, Card, Dialog, etc.)
│   ├── KpiCard.tsx          # Price KPI display card
│   ├── MapChoropleth.tsx    # Leaflet choropleth map
│   ├── PrediksiChart.tsx    # Forecast visualization (Recharts)
│   ├── TrendChart.tsx       # Historical price trend chart
│   └── DataSourceFooter.tsx # SP2KP / PIHPS attribution
├── hooks/
│   └── usePrefetch.ts       # Route-level data prefetching
├── lib/
│   ├── utils.ts             # cn() and other helpers
│   ├── cache.ts             # Cache layer utilities
│   ├── db.ts                # Dexie IndexedDB schema
│   ├── map-utils.ts         # Leaflet color scales / legend logic
│   ├── period-utils.ts      # Period mode resolution
│   └── prefetch-utils.ts    # Prefetch orchestration
├── routes/
│   ├── beranda.tsx          # `/` — overview dashboard
│   ├── home.tsx             # `/home`
│   ├── pantau-harga.tsx     # `/pantau-harga` — interactive map + KPI
│   ├── analisis-harga.tsx   # `/analisis-harga` — price analysis
│   ├── analisis-harga-versus-pasar.tsx  # cross-regency comparison
│   ├── analisis-harga-detail-pasar.tsx  # per-market wholesale detail
│   └── prediksi.tsx         # `/prediksi` — H+1 to H+4 forecasts
├── root.tsx                 # App shell (html, head, layout)
├── routes.ts                # Route configuration
├── entry.server.tsx         # SSR entry point
├── server.ts                # Hono server config
└── app.css                  # Global styles / Tailwind directives
```

## Page Mapping

| Route | Page | Description |
|---|---|---|
| `/` | Beranda | Overview dashboard, Maluku map, global price statistics |
| `/home` | Home | Landing / marketing page |
| `/pantau-harga` | Pantau Harga | Interactive choropleth map with period slider and KPI cards |
| `/analisis-harga` | Analisis Harga | Price analysis tables and charts |
| `/analisis-harga/versus-pasar` | Versus Pasar | Cross-regency commodity price comparison |
| `/analisis-harga/detail-pasar` | Detail Pasar | Per-market wholesale price breakdown |
| `/prediksi` | Prediksi | H+1 to H+4 XGBoost forecast charts with model metrics |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (runtime + package manager)
- Backend server running at `http://localhost:8000`

### Installation

```bash
bun install
```

### Environment

Create `.env` in the project root:

```env
VITE_API_URL=http://localhost:8000/api
```

### Development

```bash
bun run dev
```

### Build

```bash
bun run build
```

### Typecheck

```bash
bun run typecheck
```

## Adding shadcn Components

```bash
bunx shadcn-ui@latest add <component-name>
```

Components are installed to `app/components/ui/`.

## Design Notes

- Blue-themed interface with Geist/Inter font stack
- All layouts are responsive (mobile-first via Tailwind prefixes)
- Choropleth map uses Leaflet with GeoJSON boundary data from the backend
- Price color scale: green (stable/falling), yellow (moderate), red (rising)
- Forecast charts show confidence intervals derived from walk-forward evaluation metrics
