"""
Inference service for the Prediksi forecasting feature.

Loads a trained .joblib artifact and produces H+1…H+N change_pct predictions
for a given (pangan, kabupaten, periode_tipe) stream.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass


class ModelNotAvailable(Exception):
    pass


@dataclass
class HorizonPrediction:
    horizon: int
    predicted_change_pct: float
    predicted_harga_lkv: float
    is_up: bool
    periode_start: date
    periode_end: date


@dataclass
class PrediksiResult:
    pangan_id: int
    pangan_nama: str
    pangan_satuan: str
    pangan_harga_acuan: float
    kabupaten_kode: str
    kabupaten_nama: str
    periode_tipe: str
    current_harga_lkv: float
    current_change_pct: float | None
    current_periode_start: date
    current_periode_end: date
    predictions: list[HorizonPrediction]
    model_trained_at: str
    train_periods: int
    eval_mae_h1: float | None   # true MAE on log-returns
    eval_mae_h4: float | None
    eval_mape_h1: float | None  # MAPE on reconstructed price level
    eval_mape_h4: float | None
    eval_rmse_h1: float | None
    eval_rmse_h4: float | None


def _estimate_next_period(
    periode_tipe: str,
    current_tahun: int,
    current_nomor: int,
    horizon_step: int,
) -> tuple[date, date]:
    """
    Return the exact (start, end) of the period `horizon_step` buckets ahead,
    using the same boundary logic as aggregator._week_range / _month_range etc.
    This guarantees weekly periods always land on Monday–Friday, never on
    weekends (which SP2KP never records).
    """
    from sistem.services.aggregator import (
        _week_range,
        _month_range,
        _quarter_range,
        _semester_range,
    )
    import calendar as _cal

    if periode_tipe == "weekly":
        # Advance by horizon_step ISO weeks; handle year-boundary roll-over correctly
        # by computing the Monday of the target week and reading back its ISO year/week.
        jan4 = date(current_tahun, 1, 4)
        start_of_week1 = jan4 - timedelta(days=jan4.isocalendar()[2] - 1)
        current_monday = start_of_week1 + timedelta(weeks=current_nomor - 1)
        target_monday  = current_monday + timedelta(weeks=horizon_step)
        iso = target_monday.isocalendar()
        return _week_range(iso[0], iso[1])

    elif periode_tipe == "monthly":
        # Advance month number, rolling over the year as needed
        total_month = current_nomor + horizon_step - 1          # 0-based offset from Jan
        target_year  = current_tahun + total_month // 12
        target_month = total_month % 12 + 1
        return _month_range(target_year, target_month)

    elif periode_tipe == "quarterly":
        total_q     = current_nomor + horizon_step - 1
        target_year = current_tahun + total_q // 4
        target_q    = total_q % 4 + 1
        return _quarter_range(target_year, target_q)

    elif periode_tipe == "semesterly":
        total_s     = current_nomor + horizon_step - 1
        target_year = current_tahun + total_s // 2
        target_s    = total_s % 2 + 1
        return _semester_range(target_year, target_s)

    # Unknown tipe — should not happen in practice
    raise ValueError(f"Unknown periode_tipe: {periode_tipe!r}")


def predict(
    pangan_id: int,
    kabupaten_kode: str,
    periode_tipe: str = "weekly",
    horizon: int = 4,
    sumber_id: int = 1,
) -> PrediksiResult:
    """
    Load the trained artifact for (pangan_id, kabupaten_kode, periode_tipe) and
    run inference on the latest snapshot row.

    Raises ModelNotAvailable if no artifact exists for this stream.
    """
    import joblib
    import numpy as np
    import pandas as pd

    from sistem.models import HargaSnapshot, Pangan, PrediksiArtifact, WilayahKabupaten

    try:
        artifact_rec = PrediksiArtifact.objects.select_related("pangan", "kabupaten").get(
            pangan__master_id=pangan_id,
            pangan__sumber_id=sumber_id,
            kabupaten__kode_kabupaten=kabupaten_kode,
            periode_tipe=periode_tipe,
            is_available=True,
        )
    except PrediksiArtifact.DoesNotExist:
        raise ModelNotAvailable(
            f"No trained model for pangan_id={pangan_id}, "
            f"kabupaten={kabupaten_kode}, tipe={periode_tipe}"
        )

    artifact = joblib.load(artifact_rec.artifact_path)
    models: dict = artifact["models"]
    feature_names: list[str] = artifact["feature_names"]

    # Fetch the most recent snapshot row for this stream
    latest_snap = (
        HargaSnapshot.objects
        .filter(
            pangan__master_id=pangan_id,
            pangan__sumber_id=sumber_id,
            kabupaten__kode_kabupaten=kabupaten_kode,
            periode_tipe=periode_tipe,
        )
        .order_by("-periode_tahun", "-periode_nomor")
        .select_related("pangan", "kabupaten")
        .first()
    )

    if latest_snap is None:
        raise ModelNotAvailable("No snapshot data found for this stream")

    pangan_obj = latest_snap.pangan
    kab_obj = latest_snap.kabupaten
    target_name = pangan_obj.nama

    # Build inference feature row using the same pipeline as training
    from sistem.services.aggregator import build_training_dataframe
    from sistem.services.trainer import _build_features

    reference_kodes: list[str] = artifact.get("reference_kodes", [])
    wide_df = build_training_dataframe(
        kabupaten_kode=kabupaten_kode,
        periode_tipe=periode_tipe,
        sumber_id=sumber_id,
        change_pct_lags=2,
        reference_kabupaten_kodes=reference_kodes,
    )

    if wide_df.empty:
        raise ModelNotAvailable("Training dataframe is empty — cannot build features")

    X_all   = _build_features(wide_df, target_name)
    X_infer = X_all.iloc[[-1]].reindex(columns=feature_names, fill_value=0.0)

    current_harga_lkv  = float(latest_snap.harga_lkv)
    current_change_pct = float(latest_snap.change_pct) if latest_snap.change_pct is not None else None
    current_end = latest_snap.periode_end
    if hasattr(current_end, "date"):
        current_end = current_end.date()

    current_tahun = int(latest_snap.periode_tahun)
    current_nomor = int(latest_snap.periode_nomor)

    predictions: list[HorizonPrediction] = []
    for h in range(1, horizon + 1):
        if h not in models:
            continue
        pred_log_return = float(models[h].predict(X_infer)[0])
        pred_price      = current_harga_lkv * np.exp(pred_log_return)
        pred_change_pct = (np.exp(pred_log_return) - 1) * 100
        p_start, p_end  = _estimate_next_period(periode_tipe, current_tahun, current_nomor, h)
        predictions.append(HorizonPrediction(
            horizon=h,
            predicted_change_pct=round(pred_change_pct, 4),
            predicted_harga_lkv=round(pred_price, 2),
            is_up=pred_log_return > 0,
            periode_start=p_start,
            periode_end=p_end,
        ))

    eval_metrics = artifact.get("eval_metrics", {})
    max_h = max(models.keys()) if models else 4

    # Log forward predictions for future reconciliation
    from sistem.models import PredictionLog

    def _periode_nomor_for_date(tipe: str, d: date) -> int:
        if tipe == "weekly":
            return d.isocalendar()[1]
        elif tipe == "monthly":
            return d.month
        elif tipe == "quarterly":
            return (d.month - 1) // 3 + 1
        elif tipe == "semesterly":
            return 1 if d.month <= 6 else 2
        return 0

    pred_logs: list[PredictionLog] = []
    for hp in predictions:
        pred_logs.append(PredictionLog(
            artifact=artifact_rec,
            horizon=hp.horizon,
            periode_start=hp.periode_start,
            periode_end=hp.periode_end,
            periode_tahun=hp.periode_start.year,
            periode_nomor=_periode_nomor_for_date(periode_tipe, hp.periode_start),
            predicted_harga_lkv=hp.predicted_harga_lkv,
            predicted_change_pct=hp.predicted_change_pct,
        ))
    PredictionLog.objects.bulk_create(pred_logs, ignore_conflicts=True)

    def _m(h: int, k: str) -> float | None:
        return eval_metrics.get(h, {}).get(k)
    def _pct(v: float | None) -> float | None:
        return v * 100 if v is not None else None

    return PrediksiResult(
        pangan_id=pangan_id,
        pangan_nama=pangan_obj.nama,
        pangan_satuan=pangan_obj.satuan,
        pangan_harga_acuan=float(pangan_obj.harga_acuan) if pangan_obj.harga_acuan else 0.0,
        kabupaten_kode=kab_obj.kode_kabupaten,
        kabupaten_nama=kab_obj.nama,
        periode_tipe=periode_tipe,
        current_harga_lkv=current_harga_lkv,
        current_change_pct=current_change_pct,
        current_periode_start=latest_snap.periode_start,
        current_periode_end=current_end,
        predictions=predictions,
        model_trained_at=artifact.get("trained_at", ""),
        train_periods=artifact.get("train_periods", 0),
        eval_mae_h1=_pct(_m(1, "mae")),
        eval_mae_h4=_pct(_m(max_h, "mae")),
        eval_mape_h1=_m(1, "mape_price"),
        eval_mape_h4=_m(max_h, "mape_price"),
        eval_rmse_h1=_pct(_m(1, "rmse")),
        eval_rmse_h4=_pct(_m(max_h, "rmse")),
    )
