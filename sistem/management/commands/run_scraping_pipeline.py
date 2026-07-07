from django.core.management.base import BaseCommand

from sistem.services.aggregator import STRATEGIES
from sistem.services.scraping import ScrapingService

_SOURCE_CHOICES = ["sp2kp", "pihps_modern", "pihps_wholesale", "all"]
_TIPE_CHOICES = list(STRATEGIES.keys()) + ["all"]


class Command(BaseCommand):
    help = (
        "Run the end-to-end data pipeline: scrape → transform → seed → aggregate. "
        "Use --source to target a single pipeline; omit for all three."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--source",
            choices=_SOURCE_CHOICES,
            default="all",
            help="Which scraping pipeline to run (default: all).",
        )
        parser.add_argument(
            "--tipe",
            choices=_TIPE_CHOICES,
            default="all",
            help="HargaSnapshot period type to aggregate (default: all).",
        )
        parser.add_argument(
            "--start-date",
            dest="start_date",
            default=None,
            metavar="YYYY-MM-DD",
            help="Override scraper start date and aggregation from_date.",
        )
        parser.add_argument(
            "--end-date",
            dest="end_date",
            default=None,
            metavar="YYYY-MM-DD",
            help="Override scraper end date.",
        )
        parser.add_argument(
            "--no-resume",
            action="store_true",
            help="Restart scrapers from scratch instead of resuming progress.",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing HargaPangan rows for the source before seeding.",
        )
        parser.add_argument(
            "--full-rebuild",
            action="store_true",
            help="Delete then recreate all HargaSnapshot rows (slow; use for corrections).",
        )
        parser.add_argument(
            "--aggregate-only",
            action="store_true",
            help="Skip scraping and seeding; run aggregation only.",
        )
        parser.add_argument(
            "--incremental",
            action="store_true",
            help="Auto-compute start_date from latest DB date (skip scraper defaults); end_date=today.",
        )

    def handle(self, *args, **opts):
        svc = ScrapingService()

        if opts["aggregate_only"]:
            self.stdout.write("Running aggregation only...")
            result = svc.aggregate(
                tipe=opts["tipe"],
                from_date=opts["start_date"],
                full_rebuild=opts["full_rebuild"],
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Done. {result['created']} created, {result['updated']} updated."
                )
            )
            return

        source = opts["source"]
        sources = None if source == "all" else [source]

        self.stdout.write(f"Starting pipeline: source={source}, tipe={opts['tipe']}")

        result = svc.run_pipeline(
            sources=sources,
            tipe=opts["tipe"],
            resume=not opts["no_resume"],
            start_date=opts["start_date"],
            end_date=opts["end_date"],
            reset=opts["reset"],
            full_rebuild=opts["full_rebuild"],
            incremental=opts.get("incremental", False),
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Pipeline complete. {result['created']} snapshots created, "
                f"{result['updated']} updated."
            )
        )
