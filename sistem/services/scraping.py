"""
ScrapingService — end-to-end data ingestion pipeline.

Pipeline per source:
    scrape (raw JSON)  →  transform (CSV)  →  seed (HargaPangan)  →  aggregate (HargaSnapshot)

Three independent scraping pipelines:
  1. SP2KP        — daily prices by commodity × regency (Kemendag API)
  2. PIHPS Modern — pasar-modern, Kota Ambon (Bank Indonesia, Cloudflare-protected)
  3. PIHPS Wholesale — pedagang-besar, Ambon + Tual (Bank Indonesia)

The scrapers and transform scripts are standalone programs in raw_data/projek_akhir_data/
and are invoked as subprocesses so their own path resolution and progress-state JSON files
stay self-contained.  Seeding calls existing management commands via call_command.
Aggregation calls LPITAggregator directly.

Intended callers:
  - run_scraping_pipeline management command (cron / systemd timer / APScheduler)
  - Django views must NOT call run_pipeline() synchronously; dispatch to a background
    thread or APScheduler job to avoid blocking a gunicorn worker.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

from django.core.management import call_command
from django.db.models import Max

from sistem.models import HargaPangan
from sistem.services.aggregator import STRATEGIES, LPITAggregator
from sistem.services.logging import PipelineLogger

logger = logging.getLogger(__name__)
pipeline_logger = PipelineLogger()

# ── Paths ──────────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parents[2]
SCRAPER_DIR = BASE_DIR / "raw_data" / "projek_akhir_data"
PYTHON = sys.executable

# ── Types ──────────────────────────────────────────────────────────────────────

Source = Literal["sp2kp", "pihps_modern", "pihps_wholesale"]
PeriodTipe = Literal["weekly", "monthly", "quarterly", "semesterly", "all"]

_ALL_SOURCES: tuple[Source, ...] = ("sp2kp", "pihps_modern", "pihps_wholesale")


# ── Internal helpers ───────────────────────────────────────────────────────────

class ScrapingError(Exception):
    """Raised when a scraper or transform subprocess exits non-zero."""


def _run(args: list, cwd: Path, label: str) -> None:
    """Run a subprocess at low OS priority; raise ScrapingError on non-zero exit."""
    str_args = ["nice", "-n", "10"] + [str(a) for a in args]
    logger.info("[%s] %s", label, " ".join(str_args))
    result = subprocess.run(str_args, cwd=cwd)
    if result.returncode != 0:
        raise ScrapingError(f"{label} exited with code {result.returncode}")


def _period_tipes(tipe: PeriodTipe) -> list[str]:
    return list(STRATEGIES.keys()) if tipe == "all" else [tipe]


# ── Service ────────────────────────────────────────────────────────────────────

class ScrapingService:
    """
    Orchestrates scrape → transform → seed → aggregate for each data source.

    Each public method is independently callable so partial pipelines can be run
    (e.g. aggregate-only after a manual CSV correction).
    """

    def _latest_date_for_source(self, sumber_id: int) -> date | None:
        """
        Query the latest tanggal_update in HargaPangan for a given sumber_id.
        Returns None if no data exists yet.
        """
        result = (
            HargaPangan.objects
            .filter(pangan__sumber_id=sumber_id)
            .aggregate(latest=Max("tanggal_update"))
        )
        return result.get("latest")

    # ── Scrape ─────────────────────────────────────────────────────────────────

    def scrape_sp2kp(
        self,
        *,
        resume: bool = True,
        start_date: str | None = None,
        end_date: str | None = None,
        workers: int = 2,
    ) -> None:
        """Run the SP2KP multi-threaded daily-price scraper."""
        cmd = [PYTHON, "scraper.py", "resume" if resume else "start", "--workers", str(workers)]
        if start_date:
            cmd += ["--start-date", start_date]
        if end_date:
            cmd += ["--end-date", end_date]
        _run(cmd, SCRAPER_DIR, "SP2KP scraper")

    def scrape_pihps_modern(
        self,
        *,
        resume: bool = True,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> None:
        """Run the PIHPS pasar-modern scraper (sequential, Cloudflare bypass)."""
        cmd = [PYTHON, "scraper_pihps.py", "resume" if resume else "start"]
        if start_date:
            cmd += ["--start-date", start_date]
        if end_date:
            cmd += ["--end-date", end_date]
        _run(cmd, SCRAPER_DIR, "PIHPS modern scraper")

    def scrape_pihps_wholesale(
        self,
        *,
        resume: bool = True,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> None:
        """Run the PIHPS wholesale scraper for both per_regency and per_market modes."""
        base = [PYTHON, "scraper_wholesale.py", "resume" if resume else "start"]
        for tipe in ("per_regency", "per_market"):
            cmd = base + ["--tipe", tipe]
            if start_date:
                cmd += ["--start-date", start_date]
            if end_date:
                cmd += ["--end-date", end_date]
            _run(cmd, SCRAPER_DIR, f"PIHPS wholesale scraper ({tipe})")

    # ── Transform ──────────────────────────────────────────────────────────────

    def transform_sp2kp(
        self,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> None:
        """Convert SP2KP JSON → CSV (selects one market per regency)."""
        cmd = [PYTHON, "transform.py", "--all"]
        if start_date:
            cmd += ["--start-date", start_date]
        if end_date:
            cmd += ["--end-date", end_date]
        _run(cmd, SCRAPER_DIR, "SP2KP transform")

    def transform_pihps_modern(self) -> None:
        """Convert PIHPS pasar-modern JSON → CSV."""
        _run([PYTHON, "transform_pihps.py"], SCRAPER_DIR, "PIHPS modern transform")

    def transform_pihps_wholesale(self) -> None:
        """Convert PIHPS wholesale JSON → CSV (per_regency + per_market)."""
        _run([PYTHON, "transform_wholesale.py"], SCRAPER_DIR, "PIHPS wholesale transform")

    # ── Seed ───────────────────────────────────────────────────────────────────

    def seed_sp2kp(self, *, reset: bool = False) -> None:
        """Load SP2KP CSVs into HargaPangan (sumber_id=1)."""
        kwargs: dict = {"noinput": True}
        if reset:
            kwargs["reset"] = True
        call_command("seed_harga_harian", **kwargs)

    def seed_pihps_modern(self, *, reset: bool = False) -> None:
        """Load PIHPS pasar-modern CSVs into HargaPangan (sumber_id=2)."""
        kwargs: dict = {"noinput": True}
        if reset:
            kwargs["reset"] = True
        call_command("seed_harga_harian_pihps", **kwargs)

    def seed_pihps_wholesale(self, *, reset: bool = False) -> None:
        """Load PIHPS wholesale CSVs into HargaPangan (sumber_id=3) and HargaPanganWholesaleMarket."""
        kwargs: dict = {"noinput": True}
        if reset:
            kwargs["reset"] = True
        call_command("seed_harga_harian_wholesale", **kwargs)
        call_command("seed_harga_wholesale_regency", **kwargs)

    # ── Aggregate ──────────────────────────────────────────────────────────────

    def aggregate(
        self,
        *,
        tipe: PeriodTipe = "all",
        sumber_id: int | None = None,
        tipe_pasar: int | None = None,
        from_date: date | str | None = None,
        full_rebuild: bool = False,
    ) -> dict[str, int]:
        """
        Build / refresh HargaSnapshot rows via LPITAggregator.

        full_rebuild=True  → delete existing rows for tipe then recreate (slow, thorough)
        full_rebuild=False → incremental update from from_date (fast; defaults to 7 days ago)
        """
        if isinstance(from_date, str):
            from_date = date.fromisoformat(from_date)
        if not full_rebuild and from_date is None:
            from_date = date.today() - timedelta(days=7)

        aggregator = LPITAggregator()
        total: dict[str, int] = {"created": 0, "updated": 0}

        for t in _period_tipes(tipe):
            if full_rebuild:
                result = aggregator.run_full_rebuild(
                    periode_tipe=t,
                    sumber_id=sumber_id,
                    tipe_pasar=tipe_pasar,
                )
            else:
                result = aggregator.run_incremental(
                    periode_tipe=t,
                    from_date=from_date,
                    sumber_id=sumber_id,
                    tipe_pasar=tipe_pasar,
                )
            total["created"] += result["created"]
            total["updated"] += result["updated"]
            logger.info(
                "[aggregate] tipe=%s: %d created, %d updated",
                t, result["created"], result["updated"],
            )

        return total

    # ── Pipeline orchestrators ─────────────────────────────────────────────────

    def run_sp2kp_pipeline(
        self,
        *,
        resume: bool = True,
        start_date: str | None = None,
        end_date: str | None = None,
        reset: bool = False,
    ) -> None:
        """SP2KP full pipeline: scrape → transform → seed."""
        try:
            logger.info("=== SP2KP: scrape ===")
            self.scrape_sp2kp(resume=resume, start_date=start_date, end_date=end_date)
            pipeline_logger.log_success(
                "sp2kp", "scrape", f"Scrape complete (resume={resume}, dates={start_date}..{end_date})"
            )
        except ScrapingError as exc:
            pipeline_logger.log_failure("sp2kp", "scrape", str(exc))
            raise

        time.sleep(2)

        try:
            logger.info("=== SP2KP: transform ===")
            self.transform_sp2kp(start_date=start_date, end_date=end_date)
            pipeline_logger.log_success("sp2kp", "transform", "Transform complete")
        except ScrapingError as exc:
            pipeline_logger.log_failure("sp2kp", "transform", str(exc))
            raise

        time.sleep(2)

        try:
            logger.info("=== SP2KP: seed ===")
            self.seed_sp2kp(reset=reset)
            pipeline_logger.log_success("sp2kp", "seed", f"Seed complete (reset={reset})")
        except Exception as exc:
            pipeline_logger.log_failure("sp2kp", "seed", str(exc))
            raise

    def run_pihps_modern_pipeline(
        self,
        *,
        resume: bool = True,
        start_date: str | None = None,
        end_date: str | None = None,
        reset: bool = False,
    ) -> None:
        """PIHPS pasar-modern full pipeline: scrape → transform → seed."""
        try:
            logger.info("=== PIHPS modern: scrape ===")
            self.scrape_pihps_modern(resume=resume, start_date=start_date, end_date=end_date)
            pipeline_logger.log_success(
                "pihps_modern", "scrape", f"Scrape complete (resume={resume}, dates={start_date}..{end_date})"
            )
        except ScrapingError as exc:
            pipeline_logger.log_failure("pihps_modern", "scrape", str(exc))
            raise

        time.sleep(2)

        try:
            logger.info("=== PIHPS modern: transform ===")
            self.transform_pihps_modern()
            pipeline_logger.log_success("pihps_modern", "transform", "Transform complete")
        except ScrapingError as exc:
            pipeline_logger.log_failure("pihps_modern", "transform", str(exc))
            raise

        time.sleep(2)

        try:
            logger.info("=== PIHPS modern: seed ===")
            self.seed_pihps_modern(reset=reset)
            pipeline_logger.log_success("pihps_modern", "seed", f"Seed complete (reset={reset})")
        except Exception as exc:
            pipeline_logger.log_failure("pihps_modern", "seed", str(exc))
            raise

    def run_pihps_wholesale_pipeline(
        self,
        *,
        resume: bool = True,
        start_date: str | None = None,
        end_date: str | None = None,
        reset: bool = False,
    ) -> None:
        """PIHPS wholesale full pipeline: scrape → transform → seed."""
        try:
            logger.info("=== PIHPS wholesale: scrape ===")
            self.scrape_pihps_wholesale(resume=resume, start_date=start_date, end_date=end_date)
            pipeline_logger.log_success(
                "pihps_wholesale", "scrape", f"Scrape complete (resume={resume}, dates={start_date}..{end_date})"
            )
        except ScrapingError as exc:
            pipeline_logger.log_failure("pihps_wholesale", "scrape", str(exc))
            raise

        time.sleep(2)

        try:
            logger.info("=== PIHPS wholesale: transform ===")
            self.transform_pihps_wholesale()
            pipeline_logger.log_success("pihps_wholesale", "transform", "Transform complete")
        except ScrapingError as exc:
            pipeline_logger.log_failure("pihps_wholesale", "transform", str(exc))
            raise

        time.sleep(2)

        try:
            logger.info("=== PIHPS wholesale: seed ===")
            self.seed_pihps_wholesale(reset=reset)
            pipeline_logger.log_success("pihps_wholesale", "seed", f"Seed complete (reset={reset})")
        except Exception as exc:
            pipeline_logger.log_failure("pihps_wholesale", "seed", str(exc))
            raise

    def run_pipeline(
        self,
        sources: list[Source] | None = None,
        *,
        tipe: PeriodTipe = "all",
        resume: bool = True,
        start_date: str | None = None,
        end_date: str | None = None,
        reset: bool = False,
        full_rebuild: bool = False,
        skip_aggregate: bool = False,
        incremental: bool = False,
    ) -> dict[str, int]:
        """
        Full pipeline for one or more sources, ending with aggregation.

        sources=None runs all three.  Pass a list to run a subset, e.g. ["sp2kp"].

        If incremental=True and start_date is None, each source independently
        auto-computes its own start_date from its latest HargaPangan date, so a
        slow/old source (e.g. PIHPS Wholesale) does not force SP2KP to re-transform
        months that are already current in the DB.  end_date is always today in
        incremental mode.

        Returns aggregation stats: {"created": N, "updated": M}.
        """
        active = list(sources) if sources is not None else list(_ALL_SOURCES)
        today = str(date.today())

        # Map source name → sumber_id for DB lookups.
        _SUMBER: dict[Source, int] = {"sp2kp": 1, "pihps_modern": 2, "pihps_wholesale": 3}

        # Resolve per-source start dates.
        if incremental:
            resolved_end = end_date if end_date is not None else today
            source_starts: dict[str, str | None] = {}
            for src in active:
                if start_date is not None:
                    # Explicit override applies uniformly.
                    source_starts[src] = start_date
                else:
                    latest = self._latest_date_for_source(_SUMBER[src])
                    if latest is not None:
                        source_starts[src] = str(latest + timedelta(days=1))
                        logger.info(
                            "[run_pipeline] %s incremental: latest_db=%s, start=%s",
                            src, latest, source_starts[src],
                        )
                    else:
                        source_starts[src] = None
                        logger.info("[run_pipeline] %s incremental: no DB data, using scraper defaults", src)
        else:
            # Non-incremental: shared dates for all sources.
            resolved_end = end_date
            source_starts = {src: start_date for src in active}

        if "sp2kp" in active:
            self.run_sp2kp_pipeline(
                resume=resume,
                start_date=source_starts.get("sp2kp"),
                end_date=resolved_end,
                reset=reset,
            )

        if "pihps_modern" in active:
            self.run_pihps_modern_pipeline(
                resume=resume,
                start_date=source_starts.get("pihps_modern"),
                end_date=resolved_end,
                reset=reset,
            )

        if "pihps_wholesale" in active:
            self.run_pihps_wholesale_pipeline(
                resume=resume,
                start_date=source_starts.get("pihps_wholesale"),
                end_date=resolved_end,
                reset=reset,
            )

        if skip_aggregate:
            return {"created": 0, "updated": 0}

        # Aggregation window: earliest of all per-source starts so no snapshot is missed.
        computed_starts = [v for v in source_starts.values() if v is not None]
        agg_from = start_date or (min(computed_starts) if computed_starts else None)

        logger.info("=== Aggregate (HargaSnapshot) from %s ===", agg_from)
        try:
            result = self.aggregate(
                tipe=tipe,
                from_date=agg_from,
                full_rebuild=full_rebuild,
            )
            pipeline_logger.log_success(
                "sp2kp",
                "aggregate",
                f"Aggregation complete: {result['created']} created, {result['updated']} updated",
                details={"created": result["created"], "updated": result["updated"]},
            )
            return result
        except Exception as exc:
            pipeline_logger.log_failure("sp2kp", "aggregate", str(exc), details={"error_type": type(exc).__name__})
            raise
