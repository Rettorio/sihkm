# API Documentation — SIHPM

Base URL: `http://localhost:8000/api/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/kabupaten/` | List all districts | [doc](kabupaten-list.md) |
| `GET /api/kabupaten/geojson/` | District boundaries (GeoJSON) | [doc](kabupaten-geojson.md) |
| `GET /api/komoditas/` | List all commodities | [doc](komoditas-list.md) |
| `GET /api/harga/peta/` | Map prices with time period mode | [doc](harga-peta.md) |
| `GET /api/harga/peta/options/` | Available period options for slider | [doc](harga-peta-options.md) |
| `POST /api/harga/update/` | District price detail (legacy + mode) | [doc](harga-update.md) |

## Operations

| Document | Description |
|---|---|
| [seeder-commands.md](seeder-commands.md) | All seed commands — commodity, wilayah, daily prices, Gold layer |
| [training-command.md](training-command.md) | XGBoost model training (`train_prediksi`) |
| [pipeline-commands.md](pipeline-commands.md) | Scraping pipeline commands and incremental mode |
| [scheduler-service.md](scheduler-service.md) | systemd scheduler setup and day-to-day operations |

## Date Format

All date inputs and outputs use `DD-MM-YYYY` format (e.g. `01-04-2026`).

## Market Type (`tipe_pasar`)

- `1` — SP2KP (primary market data source)
- `3` — PIHPS Wholesale (Ambon + Tual)
