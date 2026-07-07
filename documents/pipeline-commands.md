# Pipeline Management Commands

These commands drive the full data ingestion pipeline:
**scrape → transform → seed → aggregate (HargaSnapshot)**.

All commands must be run from `/home/user/sihkm/` with the virtual environment active:

```bash
source /home/user/sihkm/.venv/bin/activate
```

---

## Commands at a Glance

| Command | Purpose |
|---|---|
| `run_scraping_pipeline` | Run scrape → transform → seed → aggregate for one or all sources |
| `start_scheduler` | Start APScheduler (daily cron, blocks in foreground) |
| `pipeline_logs` | View recent pipeline success/failure events |

---

## `run_scraping_pipeline`

Runs the full pipeline end-to-end. Each source goes through scrape → transform → seed, then all sources share a single aggregation step at the end.

```bash
python manage.py run_scraping_pipeline [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--source` | `all` | Which pipeline to run: `sp2kp`, `pihps_modern`, `pihps_wholesale`, or `all` |
| `--tipe` | `all` | HargaSnapshot period to aggregate: `weekly`, `monthly`, `quarterly`, `semesterly`, or `all` |
| `--start-date YYYY-MM-DD` | — | Override scraper start date (also sets aggregation `from_date`) |
| `--end-date YYYY-MM-DD` | — | Override scraper end date |
| `--incremental` | off | Auto-compute `start_date` from latest date in DB; `end_date` = today |
| `--no-resume` | off | Restart scrapers from scratch (ignore existing `scraping_index.json` progress) |
| `--reset` | off | Delete all existing `HargaPangan` rows for the source before seeding |
| `--full-rebuild` | off | Delete and recreate all `HargaSnapshot` rows (slow; use after a data correction) |
| `--aggregate-only` | off | Skip scraping and seeding; only rebuild/update `HargaSnapshot` |

### Examples

```bash
# Run everything incrementally (production daily use)
python manage.py run_scraping_pipeline --incremental

# Run SP2KP only for a specific date range
python manage.py run_scraping_pipeline --source sp2kp \
    --start-date 2026-01-01 --end-date 2026-06-14

# Full rebuild of HargaSnapshot after a data correction
python manage.py run_scraping_pipeline --aggregate-only --full-rebuild --tipe weekly

# Fresh start for SP2KP: wipe data, rescrape, rebuild
python manage.py run_scraping_pipeline --source sp2kp \
    --no-resume --reset --full-rebuild

# Run only aggregation for wholesale source, weekly periods only
python manage.py run_scraping_pipeline --aggregate-only \
    --source pihps_wholesale --tipe weekly
```

### Incremental Mode

When `--incremental` is passed:
1. Queries `HargaPangan` for the latest `tanggal_update` per source (`sumber_id` 1, 2, 3).
2. Takes the minimum latest date across all three sources.
3. Sets `start_date = min_latest_date + 1 day`, `end_date = today`.
4. Passes those dates to the scrapers automatically.

This ensures only the gap since the last DB record is fetched.

---

## `start_scheduler`

Starts APScheduler as a long-running blocking process. Fires `run_pipeline(incremental=True)` on a daily cron schedule.

**This is not meant to be run manually in production** — it is managed by the `sihkp-scheduler.service` systemd unit. Use it directly only for testing.

```bash
python manage.py start_scheduler [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--hour H` | `19` | Hour to fire (WIB / Asia/Jakarta, UTC+7, 0–23) |
| `--minute M` | `0` | Minute to fire (0–59) |
| `--run-now` | off | Also fire the pipeline immediately on start (in addition to the cron schedule) |

### Examples

```bash
# Start with default schedule (19:00 WIB)
python manage.py start_scheduler

# Start with a custom time
python manage.py start_scheduler --hour 20 --minute 30

# Start and fire immediately (useful for a first-run test)
python manage.py start_scheduler --run-now
```

### How It Works

- Uses `BlockingScheduler` from APScheduler 3.x — the command IS the process.
- Timezone: `Asia/Jakarta` (WIB, UTC+7). No DST adjustments needed for Indonesia.
- `misfire_grace_time=3600`: if the server restarts just before 19:00, the job still fires within the hour rather than being skipped entirely.
- All pipeline events are written to `logs/pipeline.jsonl` (see [Pipeline Logging](#pipeline-logging)).

---

## `pipeline_logs`

Displays recent success/failure events from `logs/pipeline.jsonl`. Intended for quick status checks on a low-resource VPS — no database queries, no heavy output.

```bash
python manage.py pipeline_logs [options]
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--limit N` | `20` | Show last N log entries |
| `--level` | `all` | Filter by `success`, `failure`, or `all` |
| `--json` | off | Output raw compact JSON (one line per entry) instead of formatted output |

### Examples

```bash
# Show last 20 events (default)
python manage.py pipeline_logs

# Show last 50 failures only
python manage.py pipeline_logs --level failure --limit 50

# Export as JSON for monitoring/alerting
python manage.py pipeline_logs --json > /tmp/recent_logs.jsonl

# Filter failures in JSON output
python manage.py pipeline_logs --json | grep '"level":"failure"'
```

---

## Pipeline Logging

Every scrape, transform, seed, and aggregate step writes a single compact JSON line to `logs/pipeline.jsonl`.

**Log schema:**
```json
{
  "ts": "2026-06-14T12:00:03.871234+00:00",
  "level": "success",
  "source": "sp2kp",
  "step": "scrape",
  "msg": "Scrape complete (resume=True, dates=2026-06-13..2026-06-14)",
  "details": {}
}
```

| Field | Values |
|---|---|
| `level` | `success` or `failure` |
| `source` | `sp2kp`, `pihps_modern`, `pihps_wholesale` |
| `step` | `scrape`, `transform`, `seed`, `aggregate` |
| `details` | only present on failure or for aggregate counts |

**File rotation:** max 10 MB per file, 5 backups kept (`pipeline.jsonl.1` … `.5`). Total cap ~50 MB.

---

## Data Sources

| Source | `sumber_id` | Coverage | Scraper script |
|---|---|---|---|
| SP2KP | 1 | 11 kabupaten, 16 commodities | `scraper.py` |
| PIHPS Modern | 2 | Kota Ambon only | `scraper_pihps.py` |
| PIHPS Wholesale | 3 | Ambon + Tual, 33 markets | `scraper_wholesale.py` |

Scrapers live in `raw_data/projek_akhir_data/`. They maintain a `scraping_index.json` progress file — passing `resume` (default) picks up where they left off. `--no-resume` deletes the index and starts fresh.
