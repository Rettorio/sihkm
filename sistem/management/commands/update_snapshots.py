from datetime import date

from django.core.management.base import BaseCommand, CommandError

from sistem.services.aggregator import STRATEGIES, LPITAggregator


class Command(BaseCommand):
    help = (
        "Re-aggregate HargaSnapshot rows affected by corrections to daily data on or after "
        "--from_date. Use this after editing HargaPangan records to propagate changes forward."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--from_date",
            required=True,
            help="Earliest corrected tanggal_update (YYYY-MM-DD). All snapshots whose "
                 "periode_end >= this date will be recalculated.",
        )
        parser.add_argument(
            "--tipe",
            default="all",
            choices=list(STRATEGIES.keys()) + ["all"],
            help="Period type to update (default: all).",
        )
        parser.add_argument(
            "--sumber_id",
            type=int,
            default=None,
            help="Filter by market source ID (sumber_id on Pangan). Omit for all.",
        )
        parser.add_argument(
            "--tipe_pasar",
            type=int,
            default=None,
            choices=[1, 3],
            help="Market type: 1=traditional (SP2KP, regency-level), 3=wholesale (per-market). Omit for regency-level snapshots.",
        )

    def handle(self, *args, **options):
        from_date_str = options["from_date"]
        tipe          = options["tipe"]
        sumber_id     = options["sumber_id"]
        tipe_pasar    = options["tipe_pasar"]

        try:
            from_date = date.fromisoformat(from_date_str)
        except ValueError:
            raise CommandError(f"Invalid date format '{from_date_str}'. Use YYYY-MM-DD.")

        tipes_to_run = list(STRATEGIES.keys()) if tipe == "all" else [tipe]

        aggregator = LPITAggregator()
        total_created = total_updated = 0

        for t in tipes_to_run:
            label = f"'{t}'"
            if tipe_pasar == 3:
                label += " (per-market wholesale)"
            self.stdout.write(f"  Updating {label} snapshots from {from_date}...")
            result = aggregator.run_incremental(
                periode_tipe=t,
                from_date=from_date,
                sumber_id=sumber_id,
                tipe_pasar=tipe_pasar,
            )
            created = result["created"]
            updated = result["updated"]
            total_created += created
            total_updated += updated
            self.stdout.write(
                self.style.SUCCESS(f"    {label}: {created} created, {updated} updated")
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone. Total: {total_created} created, {total_updated} updated."
            )
        )
