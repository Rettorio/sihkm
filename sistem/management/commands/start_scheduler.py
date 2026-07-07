"""
start_scheduler — run the scraping pipeline on a daily cron schedule via APScheduler.

Designed to run as a dedicated process alongside gunicorn, NOT inside a gunicorn worker.
A separate systemd unit (sihkp-scheduler.service) is the intended host.

Default schedule: 19:00 WIB (Asia/Jakarta, UTC+7).
"""

import logging

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)

_TIMEZONE = "Asia/Jakarta"


def _run_pipeline() -> None:
    """Job callback — import is deferred so Django is fully set up before first call."""
    from sistem.services.scraping import ScrapingService, ScrapingError
    from sistem.services.logging import PipelineLogger

    pipeline_logger = PipelineLogger()
    logger.info("Scheduled pipeline starting (incremental mode).")
    try:
        result = ScrapingService().run_pipeline(incremental=True)
        logger.info(
            "Scheduled pipeline complete: %d created, %d updated.",
            result["created"],
            result["updated"],
        )
        pipeline_logger.log_success(
            "sp2kp",
            "aggregate",
            f"Scheduled run complete: {result['created']} created, {result['updated']} updated",
            details={"created": result["created"], "updated": result["updated"]},
        )
    except ScrapingError as exc:
        logger.error("Scheduled pipeline failed (scraping error): %s", exc)
        pipeline_logger.log_failure("sp2kp", "aggregate", f"Scheduled run failed: {str(exc)}")
    except Exception as exc:
        logger.exception("Scheduled pipeline failed (unexpected): %s", exc)
        pipeline_logger.log_failure(
            "sp2kp", "aggregate", f"Scheduled run failed: {type(exc).__name__}: {str(exc)}"
        )


class Command(BaseCommand):
    help = (
        "Start APScheduler and run the scraping pipeline daily at --hour:--minute WIB (UTC+7). "
        "Runs as a blocking foreground process — intended for a dedicated systemd unit."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--hour",
            type=int,
            default=19,
            metavar="H",
            help="Hour to run in WIB/Asia_Jakarta (0-23). Default: 19.",
        )
        parser.add_argument(
            "--minute",
            type=int,
            default=0,
            metavar="M",
            help="Minute to run (0-59). Default: 0.",
        )
        parser.add_argument(
            "--run-now",
            action="store_true",
            help="Fire the pipeline immediately on start (in addition to the cron schedule).",
        )

    def handle(self, *args, **opts):
        hour = opts["hour"]
        minute = opts["minute"]

        scheduler = BlockingScheduler(timezone=_TIMEZONE)
        scheduler.add_job(
            _run_pipeline,
            CronTrigger(hour=hour, minute=minute, timezone=_TIMEZONE),
            id="scraping_pipeline",
            name="Daily scraping pipeline",
            replace_existing=True,
            misfire_grace_time=3600,  # allow up to 1 h late start (e.g. after reboot)
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Scheduler started. Pipeline will run daily at "
                f"{hour:02d}:{minute:02d} WIB (Asia/Jakarta)."
            )
        )

        if opts["run_now"]:
            self.stdout.write("--run-now: firing pipeline immediately.")
            scheduler.add_job(
                _run_pipeline,
                id="scraping_pipeline_immediate",
                name="Immediate run",
            )

        try:
            scheduler.start()
        except (KeyboardInterrupt, SystemExit):
            self.stdout.write("\nScheduler stopped.")
