from django.core.management.base import BaseCommand

from sistem.models import Pangan, WilayahKabupaten
from sistem.services.trainer import (
    DEFAULT_HORIZON,
    DEFAULT_MIN_PERIODS,
    DEFAULT_SUMBER_ID,
    VALID_TIPES,
    train_stream,
)


class Command(BaseCommand):
    help = "Train XGBoost walk-forward models for the Prediksi forecasting feature."

    def add_arguments(self, parser):
        parser.add_argument(
            "--pangan_id",
            type=int,
            default=None,
            help="Train only this commodity (master_id). Omit for all.",
        )
        parser.add_argument(
            "--kabupaten",
            default=None,
            help="Train only this kabupaten (kode_kabupaten). Omit for all.",
        )
        parser.add_argument(
            "--tipe",
            default="weekly",
            choices=list(VALID_TIPES) + ["all"],
            help="Period type to train (default: weekly).",
        )
        parser.add_argument(
            "--sumber_id",
            type=int,
            default=DEFAULT_SUMBER_ID,
            help=f"Market source ID on Pangan (default: {DEFAULT_SUMBER_ID}).",
        )
        parser.add_argument(
            "--horizon",
            type=int,
            default=DEFAULT_HORIZON,
            help=f"Max horizon steps to train (default: {DEFAULT_HORIZON}).",
        )
        parser.add_argument(
            "--min_periods",
            type=int,
            default=DEFAULT_MIN_PERIODS,
            help=f"Skip streams with fewer rows than this (default: {DEFAULT_MIN_PERIODS}).",
        )
        parser.add_argument(
            "--reference_kabupaten",
            nargs="*",
            default=["8101"],
            help="Kode(s) of reference/producer cities included as cross-city features (default: 8101).",
        )
        parser.add_argument(
            "--noinput",
            action="store_true",
            help="Skip confirmation prompt.",
        )

    def handle(self, *args, **options):
        pangan_id        = options["pangan_id"]
        kabupaten        = options["kabupaten"]
        tipe             = options["tipe"]
        sumber_id        = options["sumber_id"]
        horizon          = options["horizon"]
        min_periods      = options["min_periods"]
        reference_kodes  = options["reference_kabupaten"] or []
        noinput          = options["noinput"]

        tipes_to_run = list(VALID_TIPES) if tipe == "all" else [tipe]

        pangan_qs = Pangan.objects.filter(sumber_id=sumber_id)
        if pangan_id is not None:
            pangan_qs = pangan_qs.filter(master_id=pangan_id)

        kab_qs = WilayahKabupaten.objects.all()
        if kabupaten is not None:
            kab_qs = kab_qs.filter(kode_kabupaten=kabupaten)

        total_streams = pangan_qs.count() * kab_qs.count() * len(tipes_to_run)

        if not noinput:
            label_parts = []
            if pangan_id:
                label_parts.append(f"pangan_id={pangan_id}")
            if kabupaten:
                label_parts.append(f"kabupaten={kabupaten}")
            label_parts.append(f"tipe={tipe}")
            label_parts.append(f"sumber_id={sumber_id}")
            label = ", ".join(label_parts)
            confirm = input(
                f"This will train/retrain ~{total_streams} stream(s) ({label}). "
                "Type 'yes' to continue: "
            )
            if confirm.strip().lower() != "yes":
                self.stdout.write(self.style.WARNING("Aborted."))
                return

        trained = skipped = failed = 0

        for t in tipes_to_run:
            for pangan_obj in pangan_qs:
                for kab_obj in kab_qs:
                    label = (
                        f"{pangan_obj.nama} / {kab_obj.kode_kabupaten} / {t}"
                    )
                    try:
                        result = train_stream(
                            pangan_id=pangan_obj.master_id,
                            kabupaten_kode=kab_obj.kode_kabupaten,
                            periode_tipe=t,
                            sumber_id=sumber_id,
                            max_horizon=horizon,
                            min_periods=min_periods,
                            reference_kodes=reference_kodes,
                        )
                        if result.skipped:
                            skipped += 1
                            self.stdout.write(
                                self.style.WARNING(f"  SKIP  {label}: {result.skip_reason}")
                            )
                        else:
                            trained += 1
                            metrics_str = ", ".join(
                                f"H+{h}: MAE={m.get('mae', 0):.4f} "
                                f"MAPE={m.get('mape_price', 0):.2f}%"
                                for h, m in result.eval_metrics.items()
                            )
                            self.stdout.write(
                                self.style.SUCCESS(
                                    f"  OK    {label} ({result.train_periods} periods) — {metrics_str}"
                                )
                            )
                    except Exception as exc:
                        failed += 1
                        self.stdout.write(
                            self.style.ERROR(f"  FAIL  {label}: {exc}")
                        )

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone. {trained} trained, {skipped} skipped, {failed} failed."
            )
        )
