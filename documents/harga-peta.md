# `GET /api/harga/peta/` — Map Prices by Time Period

## Input

### Query Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `komoditas_id` | integer | Yes | — | Commodity ID (from `GET /api/komoditas/`) |
| `tipe_pasar` | integer | No | `1` | Market type (1 = SP2KP) |
| `mode` | string | No | `weekly` (or `daily` if `tanggal` given) | Time period mode |

### Mode-Specific Parameters

| Mode | Params | Example |
|------|--------|---------|
| `daily` | `tanggal` (DD-MM-YYYY) | `?mode=daily&tanggal=01-04-2026` |
| `weekly` | `tahun`, `minggu` | `?mode=weekly&tahun=2026&minggu=14` |
| `monthly` | `tahun`, `bulan` (1-12) | `?mode=monthly&tahun=2026&bulan=4` |
| `quarterly` | `tahun`, `kuartal` (1-4) | `?mode=quarterly&tahun=2026&kuartal=2` |
| `semesterly` | `tahun`, `semester` (1-2) | `?mode=semesterly&tahun=2026&semester=1` |
| `yearly` | `tahun` | `?mode=yearly&tahun=2026` |

If no params are given at all, defaults to the latest available week.

## Process

1. Resolves the mode + period parameters into a **date range** (start/end) and a **previous like-period** date range.
2. For each district, finds the **latest** `harga_sekarang` within the period range.
3. For each district, finds the **latest** `harga_sekarang` in the previous like-period to compute `harga_terakhir`.
4. Computes `change_pct` and `is_up` from the comparison.

**Week definition**: Monday–Friday, ISO week numbering.

**Period boundaries:**

| Mode | Period | Previous Period |
|------|--------|----------------|
| `daily` | The given date | The day before |
| `weekly` | Mon–Fri of week N | Mon–Fri of week N−1 |
| `monthly` | 1st–last day of month N | 1st–last day of month N−1 |
| `quarterly` | Calendar quarter | Previous quarter |
| `semesterly` | Jan–Jun or Jul–Dec | Previous semester |
| `yearly` | Jan–Dec of year N | Jan–Dec of year N−1 |

## Output

Array of all districts. Districts with no data in the period return `null` values.

```json
[
    {
        "kode": "8101",
        "nama": "KABUPATEN MALUKU TENGAH",
        "harga": 51667.0,
        "harga_terakhir": 48667.0,
        "change_pct": 6.16,
        "is_up": true,
        "tanggal": "30-04-2026"
    },
    {
        "kode": "8172",
        "nama": "KOTA TUAL",
        "harga": null,
        "harga_terakhir": null,
        "change_pct": null,
        "is_up": null,
        "tanggal": null
    }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `kode` | string | District code |
| `nama` | string | District name |
| `harga` | number or null | Latest price in the period |
| `harga_terakhir` | number or null | Latest price in the previous like-period |
| `change_pct` | number or null | Percentage change (`(harga - harga_terakhir) / harga_terakhir * 100`) |
| `is_up` | boolean or null | `true` if `harga > harga_terakhir` |
| `tanggal` | string or null | The date of the latest price for this district (DD-MM-YYYY) |

> **Note:** `harga_terakhir`, `change_pct`, and `is_up` are all `null` when there is no previous period (e.g. earliest period in the dataset, or yearly 2024 with no 2023 data).

## Backward Compatibility

Requests with `tanggal` and no `mode` are treated as `mode=daily`:

```
GET /api/harga/peta/?komoditas_id=13&tipe_pasar=1&tanggal=01-04-2026
```
