# `GET /api/kabupaten/geojson/` — District Boundaries (GeoJSON)

## Input

No parameters.

## Process

Returns all district boundary geometries as a GeoJSON FeatureCollection. Used for rendering the choropleth map on the frontend.

## Output

```json
{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [...]
            },
            "properties": {
                "kode_kabupaten": "8101",
                "nama": "KABUPATEN MALUKU TENGAH"
            }
        }
    ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `features[].geometry` | MultiPolygon | District boundary (SRID 4326) |
| `features[].properties.kode_kabupaten` | string | District code |
| `features[].properties.nama` | string | District name |
