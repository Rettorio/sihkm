# Seeder Commands

Seeders load raw data files into the database. They must be run in the correct order — later commands depend on records created by earlier ones.

All commands are run from `/home/user/sihkm/` with the virtual environment active:

```bash
source /home/user/sihkm/.venv/bin/activate
```

---

## Full Seed Order (fresh database)

```bash
# 1. Commodity master tables
python manage.py seed_komoditas                      # SP2KP commodities (sumber_id=1)
python manage.py seed_komoditas_pihps                # PIHPS modern commodities (sumber_id=2)
python manage.py seed_komoditas_pihps --sumber_id 3  # PIHPS wholesale commodities (sumber_id=3)

# 2. Administrative boundaries + markets
python manage.py seed_wilayah                        # Kabupaten / Kecamatan / Desa + PostGIS geometry
python manage.py seed_wilayah_pasar                  # Wholesale markets (WilayahPasar)

# 3. Daily prices (Bronze layer)
python manage.py seed_harga_harian                   # SP2KP daily prices → HargaPangan (sumber_id=1)
python manage.py seed_harga_harian_pihps             # PIHPS modern prices → HargaPangan (sumber_id=2)
python manage.py seed_harga_harian_wholesale         # Wholesale per-market → HargaPanganWholesaleMarket
python manage.py seed_harga_wholesale_regency        # Wholesale regency-aggregate → HargaPangan (sumber_id=3)

# 4. Gold layer (run after all daily prices are loaded)
python manage.py rebuild_snapshots                   # Build HargaSnapshot from HargaPangan
```

---

## Commodity Seeders

### `seed_komoditas`

Reads `raw_data/komoditas.json` → `sp2kp` section. Populates `Pangan` with `sumber_id=1`.

```bash
python manage.py seed_komoditas [--reset] [--noinput]
```

| Flag | Description |
|---|---|
| `--reset` | Delete all `Pangan` rows before seeding (prompts for confirmation) |
| `--noinput` | Skip the confirmation prompt (use with `--reset` in scripts) |

---

### `seed_komoditas_pihps`

Reads `raw_data/komoditas.json` → `pihps` section, `level=2` entries only (level=1 are parent categories, not price series). Populates `Pangan` with `sumber_id=2` or `3`.

```bash
python manage.py seed_komoditas_pihps [--sumber_id {2,3}] [--reset] [--noinput]
```

| Flag | Default | Description |
|---|---|---|
| `--sumber_id` | `2` | `2` = pasar-modern, `3` = wholesale |
| `--reset` | off | Delete all `Pangan` rows with this `sumber_id` before seeding |
| `--noinput` | off | Skip confirmation prompt |

**Run twice** — once for each `sumber_id`:
```bash
python manage.py seed_komoditas_pihps --sumber_id 2
python manage.py seed_komoditas_pihps --sumber_id 3
```

---

## Administrative Seeders

### `seed_wilayah`

Reads CSV files and an OSM GeoJSON file to populate the three administrative hierarchy tables. PostGIS polygon geometry is attached to `WilayahKabupaten` only.

**Required input files:**
- `raw_data/kabupaten_provinsi_maluku.csv`
- `raw_data/kecamatan_provinsi_maluku.csv`
- `raw_data/desa_provinsi_maluku.csv`
- `geojson/raw_maluku_kabkota.json`

```bash
python manage.py seed_wilayah [--reset] [--noinput]
```

| Flag | Description |
|---|---|
| `--reset` | Delete all rows in `WilayahDesa`, `WilayahKecamatan`, `WilayahKabupaten` (in that order) |
| `--noinput` | Skip confirmation prompt |

Tables seeded: `WilayahKabupaten` (11 rows), `WilayahKecamatan`, `WilayahDesa`.

---

### `seed_wilayah_pasar`

Reads wholesale market JSON files and an optional traditional market file to populate `WilayahPasar`.

**Required input files:**
- `raw_data/projek_akhir_data/pihps_pedagang_ambon.json` — wholesale markets in Ambon (tipe_pasar=3)
- `raw_data/projek_akhir_data/pihps_pedagang_tual.json` — wholesale markets in Tual (tipe_pasar=3)
- `raw_data/pasar/pasar_81.json` — traditional markets (tipe_pasar=1, optional)

```bash
python manage.py seed_wilayah_pasar [--reset] [--noinput]
```

| Flag | Description |
|---|---|
| `--reset` | Delete all `WilayahPasar` rows before seeding |
| `--noinput` | Skip confirmation prompt |

> Requires `seed_wilayah` to have run first (needs `WilayahKabupaten` rows for Ambon=8171 and Tual=8172).

---

## Daily Price Seeders (Bronze Layer)

All daily price seeders use `update_or_create` — safe to re-run. The `is_up` flag is computed during seeding by comparing consecutive rows sorted by date within each kabupaten.

> Zero-value and negative prices are silently skipped.

---

### `seed_harga_harian`

Reads `raw_data/harga_harian/*_harga_harian.csv`. Each CSV maps to one commodity by filename (e.g. `beras_medium_harga_harian.csv` → `Beras Medium`). Populates `HargaPangan` for `sumber_id=1`.

```bash
python manage.py seed_harga_harian [--reset] [--noinput]
```

| Flag | Description |
|---|---|
| `--reset` | Delete **all** `HargaPangan` rows before seeding |
| `--noinput` | Skip confirmation prompt |

> Requires `seed_komoditas` and `seed_wilayah` to have run first.

---

### `seed_harga_harian_pihps`

Reads `raw_data/harga_harian_pihps/*_harga_harian.csv`. Matches files to `Pangan` via slug. Populates `HargaPangan` for `sumber_id=2` (Kota Ambon only). Uses batched `bulk_create` with `update_conflicts=True`.

```bash
python manage.py seed_harga_harian_pihps [--reset] [--noinput]
```

| Flag | Description |
|---|---|
| `--reset` | Delete `HargaPangan` rows where `pangan__sumber_id=2` |
| `--noinput` | Skip confirmation prompt |

> Requires `seed_komoditas_pihps --sumber_id 2` and `seed_wilayah` to have run first.

---

### `seed_harga_harian_wholesale`

Reads per-market CSVs from `raw_data/harga_harian_pedagang_besar/per_regency/{77,78}/`. Populates `HargaPangan` for `sumber_id=3` with per-regency wholesale prices.

```bash
python manage.py seed_harga_harian_wholesale [--reset] [--noinput]
```

| Flag | Description |
|---|---|
| `--reset` | Delete `HargaPangan` rows where `pangan__sumber_id=3` |
| `--noinput` | Skip confirmation prompt |

> Requires `seed_komoditas_pihps --sumber_id 3` and `seed_wilayah` to have run first.

---

### `seed_harga_wholesale_regency`

Reads the same per-regency CSVs (`raw_data/harga_harian_pedagang_besar/per_regency/`) and seeds regency-level aggregate wholesale prices into `HargaPangan` (`sumber_id=3`). Uses batched `bulk_create` with `update_conflicts=True`.

```bash
python manage.py seed_harga_wholesale_regency [--reset] [--noinput]
```

| Flag | Description |
|---|---|
| `--reset` | Delete `HargaPangan` rows where `pangan__sumber_id=3` |
| `--noinput` | Skip confirmation prompt |

> Requires `seed_komoditas_pihps --sumber_id 3` and `seed_wilayah` to have run first.
>
> **Note:** `--reset` on this command and `seed_harga_harian_wholesale` target the same rows (`sumber_id=3`). Only use `--reset` on the first of the two commands you run.

---

## Gold Layer Commands

### `rebuild_snapshots`

Deletes and recreates `HargaSnapshot` rows using full LPIT aggregation. This is the only command that fully re-derives the Gold table from the Bronze layer.

```bash
python manage.py rebuild_snapshots [--tipe {weekly,monthly,quarterly,semesterly,all}] \
    [--sumber_id N] [--tipe_pasar {1,3}] [--noinput]
```

| Flag | Default | Description |
|---|---|---|
| `--tipe` | `all` | Period type(s) to rebuild |
| `--sumber_id` | all | Filter to one market source only |
| `--tipe_pasar` | regency-level | `1`=SP2KP regency, `3`=wholesale per-market |
| `--noinput` | off | Skip confirmation prompt |

> **Warning:** Deletes all `HargaSnapshot` rows for the given `tipe` before recreating them. Use `update_snapshots` for targeted corrections.

```bash
# Rebuild everything
python manage.py rebuild_snapshots --noinput

# Rebuild only SP2KP weekly snapshots
python manage.py rebuild_snapshots --tipe weekly --sumber_id 1

# Rebuild per-market wholesale snapshots
python manage.py rebuild_snapshots --tipe_pasar 3 --noinput
```

---

### `update_snapshots`

Re-aggregates only the `HargaSnapshot` rows whose `periode_end >= --from_date`. Use this after manually correcting `HargaPangan` records — faster than a full rebuild.

```bash
python manage.py update_snapshots --from_date YYYY-MM-DD \
    [--tipe {weekly,monthly,quarterly,semesterly,all}] \
    [--sumber_id N] [--tipe_pasar {1,3}]
```

| Flag | Required | Description |
|---|---|---|
| `--from_date` | **yes** | Earliest corrected date (YYYY-MM-DD). All snapshots whose period end ≥ this date are recalculated. |
| `--tipe` | no | Period type(s) to update (default: all) |
| `--sumber_id` | no | Filter to one market source |
| `--tipe_pasar` | no | `1`=regency-level, `3`=per-market wholesale |

```bash
# Propagate a price correction made on 2026-06-10
python manage.py update_snapshots --from_date 2026-06-10

# Update only weekly SP2KP snapshots from a specific date
python manage.py update_snapshots --from_date 2026-06-01 --tipe weekly --sumber_id 1
```

---

## Common Scenarios

### Re-seeding after scraping new data (daily use)
```bash
python manage.py seed_harga_harian
python manage.py seed_harga_harian_pihps
python manage.py seed_harga_harian_wholesale
python manage.py seed_harga_wholesale_regency
python manage.py update_snapshots --from_date 2026-06-01
```

### Fixing a corrupted price record
```bash
# 1. Fix the CSV manually, then re-seed
python manage.py seed_harga_harian

# 2. Propagate correction forward in the Gold table
python manage.py update_snapshots --from_date 2026-06-10
```

### Wiping and rebuilding everything from scratch
```bash
python manage.py seed_komoditas --reset --noinput
python manage.py seed_komoditas_pihps --sumber_id 2 --reset --noinput
python manage.py seed_komoditas_pihps --sumber_id 3 --reset --noinput
python manage.py seed_wilayah --reset --noinput
python manage.py seed_wilayah_pasar --reset --noinput
python manage.py seed_harga_harian --reset --noinput
python manage.py seed_harga_harian_pihps --reset --noinput
python manage.py seed_harga_harian_wholesale --reset --noinput
python manage.py seed_harga_wholesale_regency --noinput
python manage.py rebuild_snapshots --noinput
```
