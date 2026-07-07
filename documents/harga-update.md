# `POST /api/harga/update/` — District Price Detail

Returns commodity prices for a single district. Supports two modes:

1. **Legacy mode** — date range (`start_date` / `end_date`) grouped by day
2. **Time period mode** — single period snapshot with `mode` + period params

The endpoint auto-detects which mode to use: if `mode` is present, it uses the time period mode; otherwise it uses legacy.

---

## Legacy Mode (Date Range)

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tipe_pasar` | integer | Yes | Market type (1 = SP2KP) |
| `kabupaten` | string | Yes | District code |
| `start_date` | string | Yes | Start date (DD-MM-YYYY) |
| `end_date` | string | Yes | End date (DD-MM-YYYY) |

```json
{
    "tipe_pasar": 1,
    "kabupaten": "8101",
    "start_date": "01-04-2026",
    "end_date": "05-04-2026"
}
```

### Output

Returns all commodities for this district grouped by date.

```json
{
    "status": "partial",
    "kabupaten": {
        "kode": "8101",
        "nama": "KABUPATEN MALUKU TENGAH"
    },
    "data": {
        "01-04-2026": [
            {
                "id": 13,
                "nama": "Bawang Merah",
                "satuan": "kg",
                "harga": 48667.0,
                "harga_terakhir": 48667.0,
                "change_pct": 0.0,
                "is_up": false
            }
        ],
        "02-04-2026": [
            {
                "id": 13,
                "nama": "Bawang Merah",
                "satuan": "kg",
                "harga": 48667.0,
                "harga_terakhir": 48667.0,
                "change_pct": 0.0,
                "is_up": false
            }
        ]
    }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"full"` (all commodities have data), `"partial"`, or `"empty"` |
| `kabupaten` | object | District info |
| `data` | object | Keys are dates (DD-MM-YYYY), values are arrays of commodity entries |

---

## Time Period Mode (Single Period Snapshot)

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tipe_pasar` | integer | Yes | Market type |
| `kabupaten` | string | Yes | District code |
| `mode` | string | Yes | `daily`, `weekly`, `monthly`, `quarterly`, `semesterly`, `yearly` |
| `tanggal` | string | If mode=daily | Date (DD-MM-YYYY) |
| `tahun` | integer | If mode≠daily | Year |
| `minggu` | integer | If mode=weekly | Week number |
| `bulan` | integer | If mode=monthly | Month (1-12) |
| `kuartal` | integer | If mode=quarterly | Quarter (1-4) |
| `semester` | integer | If mode=semesterly | Semester (1-2) |

```json
{
    "tipe_pasar": 1,
    "kabupaten": "8101",
    "mode": "weekly",
    "tahun": 2026,
    "minggu": 14
}
```

### Output

Returns the latest price per commodity within the single period.

```json
{
    "status": "partial",
    "kabupaten": {
        "kode": "8101",
        "nama": "KABUPATEN MALUKU TENGAH"
    },
    "mode": "weekly",
    "period": {
        "tahun": 2026,
        "minggu": 14,
        "label": "Minggu 14 - 2026"
    },
    "data": [
        {
            "id": 13,
            "nama": "Bawang Merah",
            "satuan": "kg",
            "harga": 48667.0,
            "harga_terakhir": 48667.0,
            "change_pct": 0.0,
            "is_up": false,
            "tanggal": "02-04-2026"
        },
        {
            "id": 52,
            "nama": "Beras Medium",
            "satuan": "kg",
            "harga": 15000.0,
            "harga_terakhir": 14500.0,
            "change_pct": 3.45,
            "is_up": true,
            "tanggal": "03-04-2026"
        }
    ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"full"`, `"partial"`, or `"empty"` |
| `kabupaten` | object | District info |
| `mode` | string | The mode used |
| `period` | object | Period identifier with `label` for display |
| `data` | array | Flat array of commodity entries (latest price per commodity) |

Each commodity entry includes:
- `id`, `nama`, `satuan` — commodity info
- `harga`, `harga_terakhir`, `change_pct`, `is_up` — price data
- `tanggal` — the date of the latest price for this commodity (DD-MM-YYYY)
