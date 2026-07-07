"""
Management command to reconcile logged forward predictions with actual
HargaSnapshot data once it becomes available.

Matches PredictionLog rows (where is_reconciled=False) against HargaSnapshot
rows for the same (pangan, kabupaten, periode_tipe, periode_tahun, periode_nomor)
and fills in actual_harga_lkv / actual_change_pct.
"""
from django.core.management.base import BaseCommand
from django.db.models import F
from datetime import date


class Command(BaseCommand):
    help = "Reconcile logged predictions with actual snapshot data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--from_date",
            type=str,
            default=None,
            help="Only reconcile predictions for periods ending on or after this date (YYYY-MM-DD).",
        )
        parser.add_argument(
            "--pangan_id",
            type=int,
            default=None,
            help="Only reconcile this commodity (master_id).",
        )
        parser.add_argument(
            "--kabupaten",
            default=None,
            help="Only reconcile this kabupaten (kode_kabupaten).",
        )
        parser.add_argument(
            "--tipe",
            default=None,
            choices=["weekly", "monthly", "quarterly", "semesterly"],
            help="Only reconcile this period type.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be reconciled without making changes.",
        )

    def handle(self, *args, **options):
        from sistem.models import HargaSnapshot, PredictionLog, PrediksiArtifact

        qs = PredictionLog.objects.filter(is_reconciled=False).select_related(
            "artifact__pangan", "artifact__kabupaten"
        )

        if options["from_date"]:
            from_date = date.fromisoformat(options["from_date"])
            qs = qs.filter(periode_end__gte=from_date)

        if options["pangan_id"]:
            qs = qs.filter(artifact__pangan__master_id=options["pangan_id"])

        if options["kabupaten"]:
            qs = qs.filter(artifact__kabupaten__kode_kabupaten=options["kabupaten"])

        if options["tipe"]:
            qs = qs.filter(artifact__periode_tipe=options["tipe"])

        total = qs.count()
        if total == 0:
            self.stdout.write("No unreconciled predictions found.")
            return

        self.stdout.write(f"Found {total} unreconciled prediction(s) to process.")

        matched = 0
        updated = 0
        dry_run = options["dry_run"]

        for plog in qs.iterator(chunk_size=200):
            artifact: PrediksiArtifact = plog.artifact
            snap = (
                HargaSnapshot.objects
                .filter(
                    pangan=artifact.pangan,
                    kabupaten=artifact.kabupaten,
                    periode_tipe=artifact.periode_tipe,
                    periode_tahun=plog.periode_tahun,
                    periode_nomor=plog.periode_nomor,
                )
                .first()
            )
            if snap is None:
                continue

            matched += 1
            if dry_run:
                self.stdout.write(
                    f"  Would reconcile: {artifact.pangan.nama} / "
                    f"{artifact.kabupaten.kode_kabupaten} / H+{plog.horizon} / "
                    f"period {plog.periode_tahun}-{plog.periode_nomor} "
                    f"(pred={plog.predicted_harga_lkv}, actual={snap.harga_lkv})"
                )
                continue

            plog.actual_harga_lkv = snap.harga_lkv
            plog.actual_change_pct = snap.change_pct
            plog.is_reconciled = True
            plog.save(update_fields=["actual_harga_lkv", "actual_change_pct", "is_reconciled"])
            updated += 1

        if dry_run:
            self.stdout.write(
                self.style.SUCCESS(
                    f"\nDry run complete. {matched}/{total} would be reconciled."
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"\nDone. {updated}/{total} predictions reconciled. "
                    f"{matched - updated} had no matching snapshot."
                )
            )
