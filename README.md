# SIHKM — Sistem Informasi Harga Komoditas Maluku

A food commodity price monitoring and forecasting platform focused on the Maluku Province, Indonesia. SIHKM aggregates daily price data from multiple government sources (SP2KP and PIHPS) across 11 regencies, provides a geospatial web interface for analysis, and uses XGBoost-based forecasting to predict price movements up to four periods ahead.

<img width="1063" height="731" alt="sihkm_beranda" src="https://github.com/user-attachments/assets/d2ae7f53-e0d5-4a02-9668-d5ddf423a30c" />


## Key Features

- **Spatial Analysis** — Interactive choropleth map of Maluku showing commodity prices per kabupaten, with period-slider navigation across daily, weekly, monthly, quarterly, semesterly, and yearly granularity.
- **KPI Cards** — At-a-glance summary cards showing latest prices, price changes, and directional indicators (is_up/is_down) for every commodity-regency pair.
- **Price Granularity** — Six time aggregation modes (daily, weekly, monthly, quarterly, semesterly, yearly) with consistent previous-period comparison for change percentage calculation.
- **Regency Versus** — Side-by-side comparison of the same commodity across multiple regencies (standard market) or multiple markets within a regency (wholesale), enabling cross-region price arbitrage analysis.
- **Predictive Forecasting** — XGBoost-based walk-forward models trained per (commodity, regency, period type) stream, predicting H+1 through H+4 price levels and change percentages.
- **Automated Data Pipeline** — Daily cron-driven scraping, transformation, seeding, and aggregation pipeline with incremental mode, logging, and systemd integration.
- **Multi-Source Aggregation** — Merges SP2KP (11 kabupaten, 16 commodities), PIHPS Modern (Kota Ambon), and PIHPS Wholesale (Ambon + Tual, 33 markets) into a unified "gold table" (HargaSnapshot).

## What Makes This Different from SP2KP and PIHPS?

| Aspect | SP2KP / PIHPS (Government) | SIHKM |
|---|---|---|
| **Scope** | National, generic reports | Maluku-specific, hyperlocal |
| **Granularity** | Typically daily or monthly | 6 time modes + custom period slider |
| **Forecasting** | None (reactive reporting) | XGBoost walk-forward (H+1 to H+4) |
| **Geospatial** | Tabular data tables | Leaflet-based interactive choropleth map |
| **Cross-Regency** | Manual comparison | Built-in "versus" views and spatial lag features |
| **Data Sources** | Single source per portal | Fused SP2KP + PIHPS Modern + PIHPS Wholesale |
| **API** | Limited / no public API | Full REST API (see documentation) |
| **Open Source** | Closed | Open source (MIT) |

SIHKM transitions from **reactive monitoring** (what happened) to **proactive forecasting** (what is likely to happen), specifically designed for the logistical realities of the Maluku archipelago where inter-island transport costs dominate price formation.

## How It Works

```
                          ┌───────────────────────┐
                          │  Daily Cron (systemd)  │
                          │  19:00 WIB / APScheduler│
                          └──────┬────────────────┘
                                 │
                    ┌────────────▼──────────────┐
                    │   Scraping Service         │
                    │  (raw_data/projek_akhir_data)│
                    │  SP2KP · PIHPS Modern ·    │
                    │  PIHPS Wholesale           │
                    └────────────┬──────────────┘
                                 │ scrape → transform
                    ┌────────────▼──────────────┐
                    │  Bronze Layer              │
                    │  HargaPangan /             │
                    │  HargaPanganWholesaleMarket│
                    │  (daily raw prices)        │
                    └────────────┬──────────────┘
                                 │ seed (Django ORM)
                    ┌────────────▼──────────────┐
                    │  Gold Layer                │
                    │  HargaSnapshot             │
                    │  (pre-computed LKV,        │
                    │   lags, change_pct,        │
                    │   LOCF, per period)        │
                    └────┬───────────┬──────────┘
                         │           │
              ┌──────────▼──┐  ┌─────▼──────────┐
              │  API Layer  │  │  Training       │
              │  (Django    │  │  (XGBoost,      │
              │   REST)     │  │   walk-forward) │
              └──────┬──────┘  └─────┬──────────┘
                     │               │
              ┌──────▼──────────────────▼────────┐
              │  Frontend (Hono React)           │
              │  Beranda · Pantau Harga          │
              │  Analisis Harga · Versus ·       │
              │  Prediksi                        │
              └─────────────────────────────────┘
```

### Data Sources

| Source | Source ID | Coverage | Scraper |
|---|---|---|---|
| SP2KP | 1 | 11 kabupaten, 16 commodities | scraper.py |
| PIHPS Modern | 2 | Kota Ambon only | scraper_pihps.py |
| PIHPS Wholesale | 3 | Ambon + Tual, 33 markets | scraper_wholesale.py |

### Pipeline Flow

1. **Scrape** — Headless browser scrapers fetch daily price tables from SP2KP and PIHPS portals, maintaining a `scraping_index.json` for resume support.
2. **Transform** — Raw HTML tables are parsed, normalized, and validated into a standard schema.
3. **Seed** — Transformed data is written to `HargaPangan` (and `HargaPanganWholesaleMarket`) via Django ORM.
4. **Aggregate** — The LPITAggregator reads daily prices and computes the Gold table (`HargaSnapshot`) with period-bound LKV (last known value), previous-period comparison, lag features, LOCF flags, and change percentages.
5. **Serve** — The REST API reads from `HargaSnapshot` for map views and from trained `.joblib` artifacts for predictions.
6. **Forecast** — The frontend `/prediksi` page calls the prediction endpoint which loads the trained model for the selected (commodity, regency) stream and produces forward-looking estimates.

### Frontend Pages

| Route | Description |
|---|---|
| `/` (Beranda) | Overview dashboard, Maluku map, global price statistics |
| `/pantau-harga` | Interactive price map with period slider and KPI cards |
| `/analisis-harga` | Detailed price analysis tables and charts |
| `/analisis-harga/versus-pasar` | Cross-regency commodity comparison |
| `/analisis-harga/detail-pasar` | Per-market wholesale price detail |
| `/prediksi` | H+1 to H+4 forecast charts with model metrics |

## How We Train the Models

### Target Variable

Each model predicts **cumulative log-return** of the LKV price: `ln(P_{t+h} / P_t)`. This is more stable than raw price or percentage change for large swings, and is directly invertible to a price estimate: `predicted_price = current_price * exp(predicted_log_return)`.

### Model Architecture

One XGBRegressor per horizon step (H+1, H+2, H+3, H+4) per stream. A **stream** is defined as one combination of (commodity, kabupaten, period type). Each model is saved as a `.joblib` artifact at `media/models/prediksi/<tipe>/<kode_kab>/<pangan_id>.joblib`.

### Feature Engineering

Features are grouped into the following categories:

- **Self price features** — `change_pct`, `harga_delta`, `harga_lag1..3`, `log_return`, lagged `change_pct`
- **LOCF indicators** — Binary flag and streak counter for last-observation-carried-forward periods
- **Mean reversion** — Ratio of current price to government reference price (`harga_acuan`)
- **Seasonality** — OHE of period number + sin/cos encoding for circular awareness
- **Calendar proximity** — Days to Lebaran, Ramadan flag, post-Lebaran flag, days to Christmas
- **Inflationary pressure** — Fraction of local commodities currently rising (regime indicator)
- **Cross-commodity (supply chain groups)** — Group-mean `change_pct` for horticulture, protein, grains, and oil/sugar clusters
- **Cross-city features** — Reference kabupaten prices, spatial lags, and volatility; hub-to-local price spread (absolute gap) for catch-up pressure

### Training Procedure

Training is driven by `python manage.py train_prediksi` and implemented in `sistem/services/trainer.py`:

1. For each stream, fetch the sorted `HargaSnapshot` rows via `build_training_dataframe()`, which produces a wide DataFrame with all features pre-joined.
2. Apply walk-forward validation with **TimeSeriesSplit (n_splits=5, test_size=5 or 10%)** — each fold preserves temporal order and provides an unbiased evaluation across different seasonal regimes (Ramadan vs. off-peak vs. harvest).
3. For each horizon, train an XGBRegressor with early stopping on the full dataset after fold evaluation.
4. Save the artifact and persist a `PrediksiArtifact` DB record with evaluation metrics.
5. Persist per-row `ModelFoldEvaluation` records for downstream error-pattern analysis, bias detection, and accuracy-over-time plots.

### Hyperparameters

- `n_estimators=100`, `max_depth=4`, `learning_rate=0.1`
- `subsample=0.8`, `colsample_bytree=0.8`, `random_state=42`
- Minimum periods per stream: 26 (default, ~6 months of weekly data)
- Maximum forecast horizon: 4 (default, configurable up to 6)
- Reference kabupaten for cross-city features: 8101 (configurable)

## Model Evaluation / Metrics

Evaluation is performed during walk-forward validation on held-out folds. Three primary metrics are reported per horizon step:

| Metric | Scale | Description |
|---|---|---|
| **MAPE** (price) | Percentage | Mean Absolute Percentage Error on the *reconstructed price level*. `MAPE = mean(|actual_price - predicted_price| / actual_price) * 100`. This is the primary interpretable metric — a MAPE of 3% means the model's price estimate is off by 3% on average. |
| **MAE** (log-return) | Log-space | Mean Absolute Error on the predicted log-return. Useful for comparing models across commodities at different price levels. |
| **RMSE** (log-return) | Log-space | Root Mean Squared Error on log-return. More sensitive to large errors than MAE. |

Metrics are stored in the `PrediksiArtifact` model (aggregate per horizon) and in `ModelFoldEvaluation` (per row, per fold, per horizon) for detailed drill-down.

Typical performance on weekly models (SP2KP source) after ~2 years of training data:

| Commodity | Kabupaten | MAPE H+1 | MAPE H+4 |
|---|---|---|---|
| Beras Medium | Kota Ambon | 1.23% | 2.76% |
| Beras Premium | Kota Ambon | 1.87% | 3.12% |
| Minyak Goreng | Kota Ambon | 2.14% | 4.51% |
| Cabai Merah Keriting | Kota Ambon | 14.55% | 25.99% |
| Bawang Merah  | Kota Ambon | 7.27% | 12.95% |

High-volatility commodities (chillies) exhibit higher MAPE — this is expected given weekly price swings of 20-40% are common in Maluku's inter-island trade network.

### Retraining

Models do not self-update. Retrain manually (or via cron) using `python manage.py train_prediksi --tipe weekly --noinput` after a significant accumulation of new daily data (typically monthly). Artifacts are overwritten in-place.

## API Documentation

Full API documentation is available in the [`documents/`](documents/) directory:

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/kabupaten/` | List all districts | [doc](documents/kabupaten-list.md) |
| `GET /api/kabupaten/geojson/` | District boundaries (GeoJSON) | [doc](documents/kabupaten-geojson.md) |
| `GET /api/komoditas/` | List all commodities | [doc](documents/komoditas-list.md) |
| `GET /api/harga/peta/` | Map prices with time period mode | [doc](documents/harga-peta.md) |
| `GET /api/harga/peta/options/` | Available period options for slider | [doc](documents/harga-peta-options.md) |
| `POST /api/harga/update/` | District price detail (legacy + mode) | [doc](documents/harga-update.md) |
| `GET /api/harga/prediksi/` | Price forecasts | (in code) |
| `GET /api/harga/wholesale/side-by-side/` | Wholesale market comparison | (in code) |

Operational documentation:

| Document | Description |
|---|---|
| [seeder-commands.md](documents/seeder-commands.md) | All seed commands — commodity, wilayah, daily prices, Gold layer |
| [training-command.md](documents/training-command.md) | XGBoost model training (`train_prediksi`) |
| [pipeline-commands.md](documents/pipeline-commands.md) | Scraping pipeline commands and incremental mode |
| [scheduler-service.md](documents/scheduler-service.md) | systemd scheduler setup and day-to-day operations |

## Tech Stack

### Backend
- **Framework:** Django 6.0 + Django REST Framework
- **Database:** PostgreSQL + PostGIS
- **GIS:** django.contrib.gis (MultiPolygonField, SRID 4326)
- **ML:** XGBoost, scikit-learn, joblib, pandas, numpy
- **Scheduler:** Systemd Scehduler
- **Scraping:** Cloudscrape

### Frontend
- **Framework:** Bun Hono + React
- **Routing:** React Router DOM
- **Styling:** Tailwind CSS + shadcn/ui
- **Charts:** Recharts
- **Maps:** Leaflet / React-Leaflet

## Getting Started

### Prerequisites

- PostgreSQL with PostGIS extension
- Python 3.11+
- Node.js / Bun (for frontend)

### Backend Setup

```bash
# Clone and enter the project
git clone <repo-url> && cd sihkm

# Create virtual environment
python3 -m venv .venv && source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy environment variables
cp .env.sample .env
# Edit .env with your database credentials and secret key

# Run migrations
python manage.py migrate

# Load seed data (see documents/seeder-commands.md for full order)
python manage.py seed_komoditas
python manage.py seed_wilayah
python manage.py seed_harga_harian

# Build Gold table
python manage.py rebuild_snapshots --noinput

# Train prediction models
python manage.py train_prediksi --tipe weekly --noinput

# Start development server
python manage.py runserver
```

### Frontend Setup

```bash
cd fe-sihkp
echo "VITE_API_URL=http://localhost:8000/api" > .env
bun install
bun run dev
```

## Project Structure

```
sihkm/
├── shppm/                     # Django project configuration
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py / asgi.py
├── sistem/                    # Django application
│   ├── models.py              # All data models
│   ├── views.py               # REST API views
│   ├── urls.py                # API URL routing
│   ├── serializers.py
│   ├── admin.py
│   └── services/
│       ├── trainer.py         # XGBoost walk-forward training
│       ├── predictor.py       # Model inference service
│       ├── aggregator.py      # LPITAggregator (Bronze → Gold)
│       ├── scraping.py        # Scraping pipeline orchestration
│       └── logging.py         # Pipeline event logging
├── fe-sihkp/                  # React frontend SPA
│   └── app/
│       ├── routes/            # Page components
│       ├── components/        # UI components
│       └── services/          # API client
├── geojson/                   # Administrative boundary data
├── notebooks/                 # Training notebooks
│   ├── train_beras_weekly.ipynb
│   └── data/
├── documents/                 # API and ops documentation
│   └── prediksi_result/       # Sample forecast outputs
├── media/models/prediksi/     # Trained .joblib artifacts
├── raw_data/                  # Scraper scripts (git submodule)
├── requirements.txt
└── manage.py
```

The MIT License (MIT)
=====================

Copyright © 2026 Ardiansyah Putraman Rukua

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the “Software”), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
