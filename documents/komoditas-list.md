# `GET /api/komoditas/` — List Commodities

## Input

No parameters.

## Process

Returns all food commodities (`Pangan`) ordered by name ascending.

## Output

```json
[
    {
        "id": 13,
        "nama": "Bawang Merah",
        "satuan": "kg"
    },
    {
        "id": 38,
        "nama": "Bawang Putih Honan",
        "satuan": "kg"
    },
    {
        "id": 52,
        "nama": "Beras Medium",
        "satuan": "kg"
    }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Commodity ID (`master_id`) — used as `komoditas_id` in other endpoints |
| `nama` | string | Commodity name |
| `satuan` | string | Unit of measurement (e.g. kg, liter) |
