"""
sync_artifact_db — Sync PrediksiArtifact DB rows from uploaded .joblib files.

Workflow:
  1. Train locally:  python manage.py train_prediksi --tipe weekly
  2. Upload:         rsync -av media/models/prediksi/ vps:.../media/models/prediksi/
  3. On VPS:         python manage.py sync_artifact_db

Each .joblib already contains all the metadata needed (pangan_id, kabupaten_kode,
periode_tipe, trained_at, eval_metrics, etc.) so no re-training is required.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand

from sistem.services.trainer import ARTIFACT_ROOT


class Command(BaseCommand):
    help = "Upsert PrediksiArtifact rows from .joblib files under media/models/prediksi/"

    def add_arguments(self, parser):
        parser.add_argument(
            "--path",
            default=ARTIFACT_ROOT,
            help="Root directory to scan for .joblib artifacts (default: %(default)s)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be synced without writing to the DB",
        )

    def handle(self, *args, **options):
        import joblib

        from sistem.models import Pangan, PrediksiArtifact, WilayahKabupaten

        root = Path(options["path"])
        dry_run: bool = options["dry_run"]

        if not root.exists():
            self.stderr.write(self.style.ERROR(f"Directory not found: {root}"))
            return

        joblib_files = sorted(root.rglob("*.joblib"))
        if not joblib_files:
            self.stdout.write(self.style.WARNING(f"No .joblib files found under {root}"))
            return

        self.stdout.write(f"Found {len(joblib_files)} artifact(s) under {root}")
        if dry_run:
            self.stdout.write(self.style.WARNING("-- DRY RUN: no DB writes --"))

        created = updated = skipped = 0

        for path in joblib_files:
            label = str(path.relative_to(root))

            try:
                payload = joblib.load(path)
            except Exception as exc:
                self.stderr.write(self.style.ERROR(f"  SKIP {label}: failed to load — {exc}"))
                skipped += 1
                continue

            pangan_id      = payload.get("pangan_id")
            kabupaten_kode = payload.get("kabupaten_kode")
            periode_tipe   = payload.get("periode_tipe")
            sumber_id      = payload.get("sumber_id", 1)
            eval_metrics: dict = payload.get("eval_metrics", {})
            max_horizon    = max(eval_metrics.keys()) if eval_metrics else 4

            if not all([pangan_id, kabupaten_kode, periode_tipe]):
                self.stderr.write(self.style.ERROR(f"  SKIP {label}: missing required metadata fields"))
                skipped += 1
                continue

            trained_at_raw = payload.get("trained_at", "")
            try:
                trained_at = date.fromisoformat(trained_at_raw) if trained_at_raw else date.today()
            except ValueError:
                trained_at = date.today()

            last_period_raw = payload.get("last_snapshot_period_end", "")
            try:
                last_period_end = date.fromisoformat(last_period_raw) if last_period_raw else date.today()
            except ValueError:
                last_period_end = date.today()

            try:
                pangan_obj = Pangan.objects.get(master_id=pangan_id, sumber_id=sumber_id)
            except Pangan.DoesNotExist:
                self.stderr.write(
                    self.style.ERROR(
                        f"  SKIP {label}: Pangan(master_id={pangan_id}, sumber_id={sumber_id}) not found"
                    )
                )
                skipped += 1
                continue

            try:
                kab_obj = WilayahKabupaten.objects.get(kode_kabupaten=kabupaten_kode)
            except WilayahKabupaten.DoesNotExist:
                self.stderr.write(
                    self.style.ERROR(f"  SKIP {label}: WilayahKabupaten({kabupaten_kode}) not found")
                )
                skipped += 1
                continue

            defaults = {
                "artifact_path":            str(path),
                "trained_at":               trained_at,
                "train_periods":            payload.get("train_periods", 0),
                "last_snapshot_period_end": last_period_end,
                "eval_mae_h1":  _decimal(eval_metrics.get(1, {}).get("mae")),
                "eval_mae_h4":  _decimal(eval_metrics.get(max_horizon, {}).get("mae")),
                "eval_mape_h1": _decimal(eval_metrics.get(1, {}).get("mape_price")),
                "eval_mape_h4": _decimal(eval_metrics.get(max_horizon, {}).get("mape_price")),
                "eval_rmse_h1": _decimal(eval_metrics.get(1, {}).get("rmse")),
                "eval_rmse_h4": _decimal(eval_metrics.get(max_horizon, {}).get("rmse")),
                "is_available": True,
            }

            if dry_run:
                exists = PrediksiArtifact.objects.filter(
                    pangan=pangan_obj, kabupaten=kab_obj, periode_tipe=periode_tipe
                ).exists()
                action = "UPDATE" if exists else "CREATE"
                if exists:
                    updated += 1
                else:
                    created += 1
            else:
                _, was_created = PrediksiArtifact.objects.update_or_create(
                    pangan=pangan_obj,
                    kabupaten=kab_obj,
                    periode_tipe=periode_tipe,
                    defaults=defaults,
                )
                action = "CREATE" if was_created else "UPDATE"
                if was_created:
                    created += 1
                else:
                    updated += 1

            self.stdout.write(
                f"  {action:6s}  {pangan_obj.nama} / {kabupaten_kode} / {periode_tipe}"
                f"  (trained={trained_at}"
                f", mae_h1={defaults['eval_mae_h1']}"
                f", rmse_h1={defaults['eval_rmse_h1']})"
            )

        self.stdout.write("")
        suffix = " (dry run)" if dry_run else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"Done{suffix}: {created} created, {updated} updated, {skipped} skipped"
            )
        )


def _decimal(value) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(round(float(value), 4)))
    except (TypeError, ValueError):
        return None
