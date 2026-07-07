# Scheduler Service — Setup & Operations

The scraping scheduler runs as a dedicated systemd unit (`sihkp-scheduler.service`) on the VPS. It is completely separate from gunicorn — it does not share any processes with the web server.

---

## Architecture

```
systemd
├── sihkp-backend.service   ← gunicorn (Django API)
└── sihkp-scheduler.service ← APScheduler (scraping pipeline)
         └── fires daily at 19:00 WIB
              └── python manage.py start_scheduler
                   └── ScrapingService.run_pipeline(incremental=True)
                        ├── scrape  (subprocess: scraper.py)
                        ├── transform (subprocess: transform.py)
                        ├── seed    (call_command: seed_harga_harian*)
                        └── aggregate (LPITAggregator → HargaSnapshot)
```

---

## Service File

Location in repo: `sihkp-scheduler.service`

```ini
[Unit]
Description=SIHKP Scraping Scheduler (APScheduler)
After=network.target sihkp-backend.service
Wants=sihkp-backend.service

[Service]
Type=simple
User=<user>
WorkingDirectory=/home/user/sihkm/
Environment="PYTHONUNBUFFERED=1"
Environment="DJANGO_SETTINGS_MODULE=shppm.settings"
ExecStart=/home/user/sihkm/.venv/bin/python manage.py start_scheduler --hour 19 --minute 0

Restart=on-failure
RestartSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sihkp-scheduler

[Install]
WantedBy=multi-user.target
```

---

## Initial Setup

```bash
# 1. Copy service file from the project repository
sudo cp /home/user/sihkm/sihkp-scheduler.service /etc/systemd/system/

# 2. Reload systemd to pick up the new unit
sudo systemctl daemon-reload

# 3. Enable the service so it starts automatically on reboot
sudo systemctl enable sihkp-scheduler

# 4. Start the service now
sudo systemctl start sihkp-scheduler

# 5. Verify it is running
sudo systemctl status sihkp-scheduler
```

---

## Day-to-Day Operations

### Check service status
```bash
sudo systemctl status sihkp-scheduler
```

### View live logs (stdout/stderr from the process)
```bash
sudo journalctl -u sihkp-scheduler -f
```

### View last 50 systemd journal lines
```bash
sudo journalctl -u sihkp-scheduler --no-pager -n 50
```

### View pipeline execution events (success/failure only)
```bash
# From project directory
source /home/user/sihkm/.venv/bin/activate
python manage.py pipeline_logs

# Failures only
python manage.py pipeline_logs --level failure --limit 50
```

### Stop / start / restart
```bash
sudo systemctl stop sihkp-scheduler
sudo systemctl start sihkp-scheduler
sudo systemctl restart sihkp-scheduler
```

---

## Changing the Schedule

Edit the service file directly on the server:

```bash
sudo systemctl edit --full sihkp-scheduler
```

Change the `ExecStart` line — for example, to run at 20:30 WIB:

```ini
ExecStart=/home/user/sihkm/.venv/bin/python manage.py start_scheduler --hour 20 --minute 30
```

Then reload:
```bash
sudo systemctl daemon-reload
sudo systemctl restart sihkp-scheduler
```

---

## After Deploying Code Changes

When you pull new code to the server, restart the scheduler to pick up changes:

```bash
cd /home/user/sihkm/
git pull
sudo systemctl restart sihkp-scheduler
```

---

## Manual Pipeline Run (without the scheduler)

To run the pipeline once outside the schedule — for example after a bulk data import or to backfill a date range:

```bash
source /home/user/sihkm/.venv/bin/activate
cd /home/user/sihkm/

# Incremental (fetches only what's missing since last DB record)
python manage.py run_scraping_pipeline --incremental

# Specific date range
python manage.py run_scraping_pipeline \
    --start-date 2026-06-01 --end-date 2026-06-14

# Rebuild HargaSnapshot only (no scraping)
python manage.py run_scraping_pipeline --aggregate-only --full-rebuild
```

See [pipeline-commands.md](pipeline-commands.md) for the full command reference.

---

## Troubleshooting

### Service exits immediately
```bash
# Check the detailed error
sudo journalctl -u sihkp-scheduler -n 30 --no-pager
```

Common causes:
- Wrong `User=` — verify user exists: `id <user>`
- Wrong `WorkingDirectory=` — verify path: `ls /home/user/sihkm/manage.py`
- Wrong Python path — verify venv: `ls /home/user/sihkm/.venv/bin/python`
- `DJANGO_SETTINGS_MODULE` mismatch — check `shppm/settings.py` exists

### Pipeline fires but scraping fails
```bash
python manage.py pipeline_logs --level failure --limit 20
```

The `step` field tells you exactly where it failed: `scrape`, `transform`, `seed`, or `aggregate`.

### Missed schedule (e.g. server was down at 19:00)
APScheduler has `misfire_grace_time=3600` — if the service starts within 1 hour of the scheduled time, the job fires immediately. If the server was down longer than 1 hour, the run is skipped until the next day at 19:00.

To manually trigger the missed run:
```bash
python manage.py run_scraping_pipeline --incremental
```

### Log file sizes
```bash
ls -lh /home/user/sihkm/logs/
```

Logs rotate at 10 MB, 5 backups max (~50 MB total). If disk is tight, reduce `_BACKUP_COUNT` in `sistem/services/logging.py`.
