# `GET /api/harga/peta/options/` — Period Selector Options

Returns the full ordered list of available periods for each time mode, filtered by commodity and market type. Designed to support a slider UI — lists are ordered **oldest → newest** so the slider index maps directly to position.

## Input

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `komoditas_id` | integer | Yes | — | Commodity ID |
| `tipe_pasar` | integer | No | `1` | Market type |

## Process

1. Queries distinct `tanggal_update` values for the given commodity + market type.
2. Groups the dates into periods per mode:
   - **weekly**: by ISO year + ISO week
   - **monthly**: by calendar year + month
   - **quarterly**: by calendar year + quarter
   - **semesterly**: by calendar year + semester
   - **yearly**: by calendar year
3. Only periods that contain at least one data point are included.
4. `daily` is excluded from the list — returns `start`/`end` range so the frontend generates its own ticks.

## Output

```json
{
    "defaults": {
        "mode": "weekly",
        "tahun": 2026,
        "minggu": 18
    },
    "daily": {
        "start": "01-02-2024",
        "end": "30-04-2026"
    },
    "weekly": [
        {
            "tahun": 2024,
            "minggu": 5,
            "label": "Minggu 5 - 2024",
            "start": "29-01-2024",
            "end": "02-02-2024"
        },
        {
            "tahun": 2026,
            "minggu": 18,
            "label": "Minggu 18 - 2026",
            "start": "27-04-2026",
            "end": "01-05-2026"
        }
    ],
    "monthly": [
        {
            "tahun": 2024,
            "bulan": 2,
            "label": "Februari 2024"
        },
        {
            "tahun": 2026,
            "bulan": 4,
            "label": "April 2026"
        }
    ],
    "quarterly": [
        {
            "tahun": 2024,
            "kuartal": 1,
            "label": "Kuartal 1 - 2024"
        },
        {
            "tahun": 2026,
            "kuartal": 2,
            "label": "Kuartal 2 - 2026"
        }
    ],
    "semesterly": [
        {
            "tahun": 2024,
            "semester": 1,
            "label": "Semester 1 - 2024"
        },
        {
            "tahun": 2026,
            "semester": 1,
            "label": "Semester 1 - 2026"
        }
    ],
    "yearly": [
        {
            "tahun": 2024,
            "label": "2024"
        },
        {
            "tahun": 2026,
            "label": "2026"
        }
    ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `defaults` | object | Initial slider state (latest week) |
| `daily` | object or null | `start`/`end` date range for frontend to generate daily ticks |
| `weekly` | array | Ordered list of available weeks |
| `monthly` | array | Ordered list of available months |
| `quarterly` | array | Ordered list of available quarters |
| `semesterly` | array | Ordered list of available semesters |
| `yearly` | array | Ordered list of available years |

Each period object includes:
- `tahun` + period field (`minggu`/`bulan`/`kuartal`/`semester`)
- `label` for display (e.g. `"Minggu 18 - 2026"`, `"April 2026"`)
- `weekly` entries also include `start`/`end` dates (Mon–Fri)
