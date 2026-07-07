from django.core.management.base import BaseCommand

from sistem.services.aggregator import STRATEGIES, LPITAggregator


class Command(BaseCommand):
    help = "Rebuild HargaSnapshot table from scratch using the LPIT aggregator."

    def add_arguments(self, parser):
        parser.add_argument(
            "--tipe",
            default="all",
            choices=list(STRATEGIES.keys()) + ["all"],
            help="Period type to rebuild (default: all).",
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
        parser.add_argument(
            "--noinput",
            action="store_true",
            help="Skip confirmation prompt.",
        )

    def handle(self, *args, **options):
        tipe      = options["tipe"]
        sumber_id = options["sumber_id"]
        tipe_pasar = options["tipe_pasar"]
        noinput   = options["noinput"]

        tipes_to_run = list(STRATEGIES.keys()) if tipe == "all" else [tipe]

        if not noinput:
            parts = [f"tipe={tipe}"]
            if sumber_id:
                parts.append(f"sumber_id={sumber_id}")
            if tipe_pasar:
                parts.append(f"tipe_pasar={tipe_pasar}")
            label = ", ".join(parts)
            confirm = input(
                f"This will DELETE and re-create all HargaSnapshot rows for {label}. "
                "Type 'yes' to continue: "
            )
            if confirm.strip().lower() != "yes":
                self.stdout.write(self.style.WARNING("Aborted."))
                return

        aggregator = LPITAggregator()
        total_created = total_updated = 0

        for t in tipes_to_run:
            label = f"'{t}'"
            if tipe_pasar == 3:
                label += " (per-market wholesale)"
            self.stdout.write(f"  Rebuilding {label} snapshots...")
            result = aggregator.run_full_rebuild(
                periode_tipe=t,
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
