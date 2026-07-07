# `GET /api/kabupaten/` — List Districts

## Input

No parameters.

## Process

Returns all districts (`WilayahKabupaten`) ordered by name ascending.

## Output

```json
[
    {
        "kode": "8101",
        "nama": "KABUPATEN MALUKU TENGAH"
    },
    {
        "kode": "8102",
        "nama": "KABUPATEN MALUKU TENGGARA"
    },
    {
        "kode": "8171",
        "nama": "KOTA AMBON"
    },
    {
        "kode": "8172",
        "nama": "KOTA TUAL"
    }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `kode` | string | District code (PK) |
| `nama` | string | District name |
