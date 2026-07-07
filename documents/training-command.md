# Training Command

The `train_prediksi` command trains XGBoost walk-forward models for the price forecasting feature (`/prediksi` route). Each trained model covers one combination of commodity × kabupaten × period type.

All commands are run from `/home/user/sihkm/` with the virtual environment active:

```bash
source /home/user/sihkm/.venv/bin/activate
```

---

## Prerequisites

`HargaSnapshot` must be populated before training. If it is empty, run the seeders first:

```bash
python manage.py rebuild_snapshots --noinput
```

---

## `train_prediksi`

```bash
python manage.py train_prediksi [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--tipe` | `weekly` | Period type to train: `weekly`, `monthly`, `quarterly`, `semesterly`, or `all` |
| `--sumber_id` | `1` | Market source: `1`=SP2KP, `3`=wholesale |
| `--pangan_id` | all | Train only this commodity (`master_id` on `Pangan`). Omit for all. |
| `--kabupaten` | all | Train only this kabupaten (`kode_kabupaten`). Omit for all. |
| `--horizon` | `4` | Max forecast horizon steps (1–6). |
| `--min_periods` | `26` | Skip streams with fewer than this many snapshot rows. Prevents training on too-short series. |
| `--reference_kabupaten` | `8101` | One or more kabupaten codes whose prices are included as cross-city features. Separate multiple with spaces. |
| `--noinput` | off | Skip confirmation prompt. |

### Examples

```bash
# Train all SP2KP commodities × all kabupaten, weekly (standard production run)
python manage.py train_prediksi --tipe weekly --noinput

# Train all period types
python manage.py train_prediksi --tipe all --noinput

# Train a single commodity in a single kabupaten (fast, for testing)
python manage.py train_prediksi --pangan_id 1 --kabupaten 8171 --tipe weekly

# Train wholesale source
python manage.py train_prediksi --sumber_id 3 --tipe weekly --noinput

# Train with a longer horizon (up to 6 weeks ahead)
python manage.py train_prediksi --tipe weekly --horizon 6 --noinput

# Use multiple reference kabupaten as cross-city features
python manage.py train_prediksi --tipe weekly --reference_kabupaten 8101 8171 --noinput
```

---

## How It Works

Training uses a **walk-forward validation** strategy from `sistem/services/trainer.py`:

1. For each `(pangan, kabupaten, tipe)` stream, fetches the sorted `HargaSnapshot` rows.
2. Splits into expanding training windows; for each window trains an XGBoost model and evaluates on the held-out step.
3. The final model is trained on the full series and saved as a `.joblib` file in `media/models/prediksi/`.
4. A `PrediksiArtifact` record is created/updated in the database pointing to that file.

**MAPE** (Mean Absolute Percentage Error on price) is reported per horizon step in the terminal output.

---

## Output

**Terminal output per stream:**
```
OK    Beras Medium / 8171 / weekly (52 periods) — H+1: MAPE=1.23%, H+2: MAPE=1.87%, H+3: MAPE=2.14%, H+4: MAPE=2.76%
SKIP  Beras Premium / 8109 / weekly: not enough periods (18 < 26)
FAIL  Cabai Rawit / 8103 / weekly: [error details]
```

**Saved artifacts:** `media/models/prediksi/<slug>_<kode_kab>_<tipe>.joblib`

**Database:** `PrediksiArtifact` table — one row per stream, unique on `(pangan, kabupaten, periode_tipe)`.

---

## Retraining

Models do not update automatically. Retrain after a significant amount of new daily price data has been added — typically once per month for weekly models.

```bash
# Standard monthly retrain (all SP2KP weekly)
python manage.py train_prediksi --tipe weekly --noinput

# Retrain all period types (slower)
python manage.py train_prediksi --tipe all --noinput
```

---

## Performance Notes

- Training all SP2KP commodities (16) × all kabupaten (11) × weekly = **176 streams**. Expect several minutes on a low-resource VPS.
- `--min_periods 26` is the safe minimum for weekly models (≈ 6 months of data). Lowering it risks underfitting.
- Run training during off-peak hours to avoid competing with gunicorn workers for CPU.
- Artifacts in `media/models/prediksi/` are overwritten in-place on retrain — no manual cleanup needed.
