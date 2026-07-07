"""
Export predictions for paper purposes into a single large JSON file.

For each (kabupaten, komoditas) combination, calls the predict() service to
get forward predictions and reads eval metrics from the artifact. Combines
everything into one structured JSON file suitable for citation/paper appendix.

With --backtest N, also includes walk-forward predictions vs actuals for
the N most recent periods (showing what the model predicted 1..4 weeks back).
"""
import json
from datetime import date, datetime

from django.core.management.base import BaseCommand, CommandError

# Komoditas name normalization for paper
KOMODITAS_ALIAS = {
    "Cabai Merah Keriting": "Cabai Merah",
    "Cabai Rawit Merah": "Cabai Rawit",
    "Beras Premium": "Beras Premium",
    "Beras Medium": "Beras Medium",
    "Telur Ayam Ras": "Telur Ayam",
    "Daging Ayam Ras": "Daging Ayam",
    "Bawang Merah": "Bawang Merah",
    "Minyakita": "Minyakita",
    "Gula Pasir Curah": "Gula Pasir",
}


class Command(BaseCommand):
    help = "Export predictions to a single JSON file for paper purposes."

    def add_arguments(self, parser):
        parser.add_argument(
            "--kabupaten",
            nargs="+",
            required=True,
            help="Kode kabupaten to include (e.g. 8171 8101 8107 8105)",
        )
        parser.add_argument(
            "--komoditas",
            nargs="+",
            required=True,
            help="Komoditas master_id(s) to include (e.g. 2 52 25)",
        )
        parser.add_argument(
            "--tipe",
            default="weekly",
            choices=["weekly", "monthly", "quarterly", "semesterly"],
            help="Period type (default: weekly)",
        )
        parser.add_argument(
            "--horizon",
            type=int,
            default=4,
            help="Max horizon steps (default: 4)",
        )
        parser.add_argument(
            "--sumber_id",
            type=int,
            default=1,
            help="Market source ID (default: 1 = SP2KP)",
        )
        parser.add_argument(
            "--backtest",
            type=int,
            default=0,
            help="Include last N periods of walk-forward predictions vs actuals (default: 0, off)",
        )
        parser.add_argument(
            "--output",
            default="documents/prediksi_result/paper_data.json",
            help="Output JSON file path (default: documents/prediksi_result/paper_data.json)",
        )

    def handle(self, *args, **options):
        from django.db.models import Avg
        from sistem.models import ModelFoldEvaluation, Pangan, PrediksiArtifact, WilayahKabupaten
        from sistem.services.predictor import ModelNotAvailable, predict as prediksi_predict

        kabupaten_kodes = options["kabupaten"]
        komoditas_ids = options["komoditas"]
        tipe = options["tipe"]
        horizon = options["horizon"]
        sumber_id = options["sumber_id"]
        output_path = options["output"]
        backtest = options["backtest"]

        # Resolve komoditas
        pangan_map: dict[str, str] = {}
        for pid in komoditas_ids:
            try:
                p = Pangan.objects.get(master_id=str(pid), sumber_id=sumber_id)
                pangan_map[pid] = p.nama
            except Pangan.DoesNotExist:
                self.stderr.write(self.style.WARNING(f"  SKIP komoditas_id={pid}: not found"))

        if not pangan_map:
            raise CommandError("No valid komoditas found.")

        # Resolve kabupaten
        kab_map: dict[str, str] = {}
        for kode in kabupaten_kodes:
            try:
                k = WilayahKabupaten.objects.get(kode_kabupaten=kode)
                kab_map[kode] = k.nama
            except WilayahKabupaten.DoesNotExist:
                self.stderr.write(self.style.WARNING(f"  SKIP kabupaten={kode}: not found"))

        if not kab_map:
            raise CommandError("No valid kabupaten found.")

        items: list[dict] = []
        errors: list[str] = []

        for kode in kabupaten_kodes:
            if kode not in kab_map:
                continue
            for pid in komoditas_ids:
                if pid not in pangan_map:
                    continue
                label = f"{pangan_map[pid]} / {kab_map[kode]}"
                self.stdout.write(f"  Processing {label}...", ending="")

                try:
                    result = prediksi_predict(
                        pangan_id=str(pid),
                        kabupaten_kode=kode,
                        periode_tipe=tipe,
                        horizon=horizon,
                        sumber_id=sumber_id,
                    )

                    # Build evaluation metrics from artifact
                    try:
                        art = PrediksiArtifact.objects.get(
                            pangan__master_id=str(pid),
                            pangan__sumber_id=sumber_id,
                            kabupaten__kode_kabupaten=kode,
                            periode_tipe=tipe,
                            is_available=True,
                        )
                        eval_mae_h1 = float(art.eval_mae_h1) if art.eval_mae_h1 else None
                        eval_mae_h4 = float(art.eval_mae_h4) if art.eval_mae_h4 else None
                        eval_mape_h1 = float(art.eval_mape_h1) if art.eval_mape_h1 else None
                        eval_mape_h4 = float(art.eval_mape_h4) if art.eval_mape_h4 else None
                        eval_rmse_h1 = float(art.eval_rmse_h1) if art.eval_rmse_h1 else None
                        eval_rmse_h4 = float(art.eval_rmse_h4) if art.eval_rmse_h4 else None
                    except PrediksiArtifact.DoesNotExist:
                        eval_mae_h1 = eval_mae_h4 = None
                        eval_mape_h1 = eval_mape_h4 = None
                        eval_rmse_h1 = eval_rmse_h4 = None

                    item: dict = {
                        "kabupaten": {
                            "kode": kode,
                            "nama": kab_map[kode],
                        },
                        "komoditas": {
                            "id": pid,
                            "nama": pangan_map[pid],
                            "nama_paper": KOMODITAS_ALIAS.get(pangan_map[pid], pangan_map[pid]),
                        },
                        "current": {
                            "harga_lkv": result.current_harga_lkv,
                            "change_pct": result.current_change_pct,
                            "periode_start": str(result.current_periode_start),
                            "periode_end": str(result.current_periode_end),
                        },
                        "predictions": [
                            {
                                "horizon": hp.horizon,
                                "predicted_harga_lkv": hp.predicted_harga_lkv,
                                "predicted_change_pct": hp.predicted_change_pct,
                                "is_up": hp.is_up,
                                "periode_start": str(hp.periode_start),
                                "periode_end": str(hp.periode_end),
                            }
                            for hp in result.predictions
                        ],
                        "eval_metrics": {
                            "mae_h1": eval_mae_h1,
                            "mae_h4": eval_mae_h4,
                            "mape_h1": eval_mape_h1,
                            "mape_h4": eval_mape_h4,
                            "rmse_h1": eval_rmse_h1,
                            "rmse_h4": eval_rmse_h4,
                        },
                    }

                    # Backtest: walk-forward predictions for last N periods
                    if backtest > 0 and art:
                        recent_periods = (
                            ModelFoldEvaluation.objects
                            .filter(artifact=art)
                            .values("periode_end")
                            .annotate(avg_actual=Avg("actual_harga_lkv"))
                            .order_by("-periode_end")[:backtest]
                        )

                        backtest_rows: list[dict] = []
                        for rp in recent_periods:
                            target_end = rp["periode_end"]
                            actual_val = float(round(rp["avg_actual"], 2))

                            horizons_qs = (
                                ModelFoldEvaluation.objects
                                .filter(artifact=art, periode_end=target_end)
                                .values("horizon")
                                .annotate(
                                    avg_predicted=Avg("predicted_harga_lkv"),
                                    avg_error=Avg("abs_pct_error"),
                                )
                                .order_by("horizon")
                            )

                            h_list: list[dict] = []
                            for h_row in horizons_qs:
                                pred_val = float(round(h_row["avg_predicted"], 2))
                                err_val = round(float(h_row["avg_error"]), 4) if h_row["avg_error"] is not None else None
                                h_list.append({
                                    "horizon": h_row["horizon"],
                                    "predicted_harga_lkv": pred_val,
                                    "abs_pct_error": err_val,
                                })

                            if h_list:
                                backtest_rows.append({
                                    "target_periode_end": str(target_end),
                                    "actual_harga_lkv": actual_val,
                                    "horizons": h_list,
                                })

                        if backtest_rows:
                            item["backtest"] = backtest_rows

                    items.append(item)
                    self.stdout.write(self.style.SUCCESS(" OK"))

                except ModelNotAvailable as exc:
                    errors.append(f"{label}: {exc}")
                    self.stdout.write(self.style.WARNING(" SKIP (no model)"))

                except Exception as exc:
                    errors.append(f"{label}: {exc}")
                    self.stdout.write(self.style.ERROR(" FAIL"))

        description = (
            "Prediksi harga pangan untuk paper. "
            "current = periode harga terakhir dari Gold table; "
            "predictions = forward forecast H+1..H+4; "
            "eval_metrics = walk-forward validation (predicted vs actual historis)."
        )
        if backtest > 0:
            description += (
                f" backtest = walk-forward predictions for the last {backtest} "
                f"periods, showing predicted vs actual per horizon."
            )

        package = {
            "metadata": {
                "generated_at": datetime.now().isoformat(),
                "tipe": tipe,
                "horizon": horizon,
                "sumber_id": sumber_id,
                "backtest_periods": backtest,
                "description": description,
            },
            "items": items,
        }

        with open(output_path, "w") as f:
            json.dump(package, f, indent=2, ensure_ascii=False)

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone. {len(items)} stream(s) exported to {output_path}"
            )
        )
        if errors:
            self.stderr.write(
                self.style.WARNING(f"\n{len(errors)} error(s):")
            )
            for err in errors:
                self.stderr.write(f"  - {err}")
