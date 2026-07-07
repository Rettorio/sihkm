"""
Walk-forward XGBoost training for commodity price-change forecasting.

Each (pangan, kabupaten, periode_tipe) stream gets one .joblib artifact
containing a separate XGBRegressor per horizon step (H+1 … H+max_horizon).
Target variable: change_pct — % change relative to the previous period's LKV.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd

VALID_TIPES = ("weekly", "monthly", "quarterly", "semesterly")
DEFAULT_HORIZON = 4
DEFAULT_MIN_PERIODS = 26
DEFAULT_SUMBER_ID = 1
ARTIFACT_ROOT = os.path.join("media", "models", "prediksi")

# Supply-chain commodity groups for group-mean cross-commodity features.
# Commodities in the same group share logistics (same ships, same middlemen).
SUPPLY_CHAIN_GROUPS: dict[str, list[str]] = {
    "horticulture": [
        "Cabai Merah Keriting", "Cabai Rawit Merah",
        "Bawang Merah", "Bawang Putih Honan", "Bawang Putih Kating", "Tomat",
    ],
    "protein": [
        "Daging Ayam Ras", "Telur Ayam Ras",
        "Daging Sapi Paha Belakang", "Daging Sapi Paha Depan",
    ],
    "grains": ["Beras Premium", "Beras Medium"],
    "oil_sugar": [
        "Gula Pasir Kemasan", "Gula Pasir Curah",
        "Minyak Goreng Sawit Kemasan Premium", "Minyakita",
    ],
}
_COM_TO_GROUP: dict[str, str] = {
    com: grp for grp, coms in SUPPLY_CHAIN_GROUPS.items() for com in coms
}


@dataclass
class TrainResult:
    pangan_id: int
    kabupaten_kode: str
    periode_tipe: str
    artifact_path: str
    train_periods: int
    last_snapshot_period_end: date
    eval_metrics: dict[int, dict[str, float]]
    skipped: bool = False
    skip_reason: str = ""

    @property
    def eval_mae_h1(self) -> float | None:
        return self.eval_metrics.get(1, {}).get("mae")

    @property
    def eval_mae_h4(self) -> float | None:
        return self.eval_metrics.get(4, {}).get("mae")

    @property
    def eval_mape_h1(self) -> float | None:
        return self.eval_metrics.get(1, {}).get("mape_price")

    @property
    def eval_mape_h4(self) -> float | None:
        return self.eval_metrics.get(4, {}).get("mape_price")


def _target_col(commodity_name: str) -> str:
    return f"{commodity_name}_change_pct"


def _build_features(
    wide_df: "pd.DataFrame",
    target_name: str,
) -> "pd.DataFrame":
    """
    Build the complete feature matrix X for all rows (no target, no validity filter).
    Used by both _build_feature_matrix (training) and the predictor (inference).
    """
    import numpy as np
    import pandas as pd

    tgt_col = _target_col(target_name)
    feat: dict[str, "pd.Series"] = {}

    # Self price features
    feat["self_change_pct"]  = wide_df.get(tgt_col,                         pd.Series(dtype=float))
    feat["self_harga_delta"] = wide_df.get(f"{target_name}_harga_delta",     pd.Series(dtype=float))
    feat["self_harga_lag1"]  = wide_df.get(f"{target_name}_harga_lag1",      pd.Series(dtype=float))
    feat["self_harga_lag2"]  = wide_df.get(f"{target_name}_harga_lag2",      pd.Series(dtype=float))
    feat["self_harga_lag3"]  = wide_df.get(f"{target_name}_harga_lag3",      pd.Series(dtype=float))

    # Self log-return: ln(P_t / P_{t-1}) — better-behaved than % change for large swings
    harga_col = f"{target_name}_harga_lkv"
    lag1_col  = f"{target_name}_harga_lag1"
    if harga_col in wide_df.columns and lag1_col in wide_df.columns:
        cur  = wide_df[harga_col].replace(0, np.nan)
        prev = wide_df[lag1_col].replace(0, np.nan)
        feat["self_log_return"] = np.log(cur / prev).fillna(0.0)

    # Lagged change_pct (pre-computed by build_training_dataframe)
    for lag in (1, 2):
        col = f"{target_name}_change_pct_lag{lag}"
        if col in wide_df.columns:
            feat[f"self_change_pct_lag{lag}"] = wide_df[col]

    # LOCF features: binary flag + consecutive-period streak
    locf_col   = f"{target_name}_is_locf"
    streak_col = f"{target_name}_locf_streak"
    if locf_col   in wide_df.columns:
        feat["self_is_locf"]     = wide_df[locf_col].astype(float)
    if streak_col in wide_df.columns:
        feat["self_locf_streak"] = wide_df[streak_col].astype(float)

    # Mean reversion: how far is current price from government reference?
    acuan_col = f"{target_name}_price_to_acuan"
    if acuan_col in wide_df.columns:
        feat["self_price_to_acuan"] = wide_df[acuan_col]

    # Seasonality: OHE (tree-friendly) + sin/cos (circular awareness)
    for col in wide_df.columns:
        if col.startswith("period_num_") or col in ("sin_period", "cos_period"):
            feat[col] = wide_df[col]
    if not any(c.startswith("period_num_") for c in wide_df.columns):
        feat["periode_nomor"] = wide_df["periode_nomor"].astype(float)

    # Islamic + Christian calendar proximity
    for col in wide_df.columns:
        if col.startswith("cal_"):
            feat[col] = wide_df[col]

    # Inflationary pressure: fraction of local commodities currently rising.
    # Regime indicator — if 80%+ are rising, a single flat commodity will likely follow.
    local_chg_cols = [
        c for c in wide_df.columns
        if c.endswith("_change_pct") and "_ref_" not in c and "_lag" not in c
    ]
    if local_chg_cols:
        feat["inflationary_pressure"] = (wide_df[local_chg_cols] > 0).mean(axis=1)

    # Cross-commodity: supply-chain group means replace noisy individual series.
    # Commodities outside defined groups fall back to individual cross-com features.
    all_coms = _detect_commodities(wide_df)
    group_members: dict[str, list["pd.Series"]] = {}
    for com in all_coms:
        if com == target_name:
            continue
        col = _target_col(com)
        if col not in wide_df.columns:
            continue
        grp = _COM_TO_GROUP.get(com)
        if grp:
            group_members.setdefault(grp, []).append(wide_df[col])
        else:
            feat[f"cross_{com}_change_pct"] = wide_df[col]
    for grp, series_list in group_members.items():
        feat[f"group_{grp}_mean_change_pct"] = pd.concat(series_list, axis=1).mean(axis=1)

    # Cross-city: change_pct current + spatial lags + volatility (already pre-computed)
    for col in wide_df.columns:
        if "_change_pct_ref_" in col:
            feat[col] = wide_df[col]

    # Hub-to-local price spread: absolute gap between reference city and local price level.
    # Captures catch-up pressure: a large positive spread means local price is "due" to rise.
    local_harga_col = f"{target_name}_harga_lkv"
    if local_harga_col in wide_df.columns:
        for col in wide_df.columns:
            if col == f"{target_name}_harga_lkv_ref_" or col.startswith(f"{target_name}_harga_lkv_ref_"):
                ref_kode = col.split("_ref_")[-1]
                feat[f"hub_price_gap_{ref_kode}"] = wide_df[col] - wide_df[local_harga_col]

    return pd.DataFrame(feat, index=wide_df.index)


def _build_feature_matrix(
    wide_df: "pd.DataFrame",
    target_name: str,
    horizon: int,
    max_horizon: int,
) -> tuple["pd.DataFrame", "pd.Series"]:
    """
    Build (X, y) for one horizon step.
    Target: cumulative log-return ln(P_{t+h} / P_t) — directly reconstructable to price.
    """
    import numpy as np

    X = _build_features(wide_df, target_name)

    harga_col = f"{target_name}_harga_lkv"
    if harga_col in wide_df.columns:
        future_p  = wide_df[harga_col].shift(-horizon)
        current_p = wide_df[harga_col].replace(0, np.nan)
        y = np.log(future_p / current_p)
    else:
        y = wide_df[_target_col(target_name)].shift(-horizon)

    valid = X.notna().all(axis=1) & y.notna()
    return X[valid], y[valid]


def _detect_commodities(wide_df: "pd.DataFrame") -> list[str]:
    """Extract commodity names from wide_df column names (suffix _change_pct)."""
    commodities = []
    for col in wide_df.columns:
        if col.endswith("_change_pct"):
            commodities.append(col[: -len("_change_pct")])
    return commodities


def _mae(y_true, y_pred) -> float:
    import numpy as np
    return float(np.mean(np.abs(np.array(y_true) - np.array(y_pred))))


def _rmse(y_true, y_pred) -> float:
    import numpy as np
    return float(np.sqrt(np.mean((np.array(y_true) - np.array(y_pred)) ** 2)))


def _mape(y_true, y_pred) -> float | None:
    import numpy as np
    yt = np.array(y_true, dtype=float)
    yp = np.array(y_pred, dtype=float)
    nonzero = yt != 0
    if not nonzero.any():
        return None
    return float(np.mean(np.abs((yt[nonzero] - yp[nonzero]) / yt[nonzero])) * 100)


def train_stream(
    pangan_id: int,
    kabupaten_kode: str,
    periode_tipe: str,
    sumber_id: int = DEFAULT_SUMBER_ID,
    max_horizon: int = DEFAULT_HORIZON,
    min_periods: int = DEFAULT_MIN_PERIODS,
    reference_kodes: "list[str] | None" = None,
) -> TrainResult:
    """
    Train direct multi-output XGBoost models for one (pangan, kabupaten, tipe) stream.
    Returns a TrainResult; persists the artifact to disk and upserts PrediksiArtifact DB row.
    """
    import joblib
    import numpy as np
    import pandas as pd
    from sklearn.model_selection import TimeSeriesSplit
    from xgboost import XGBRegressor

    from sistem.models import Pangan, PrediksiArtifact, WilayahKabupaten
    from sistem.services.aggregator import build_training_dataframe

    try:
        pangan_obj = Pangan.objects.get(master_id=pangan_id, sumber_id=sumber_id)
    except Pangan.DoesNotExist:
        return TrainResult(
            pangan_id=pangan_id, kabupaten_kode=kabupaten_kode,
            periode_tipe=periode_tipe, artifact_path="",
            train_periods=0, last_snapshot_period_end=date.today(),
            eval_metrics={}, skipped=True,
            skip_reason=f"Pangan master_id={pangan_id} sumber_id={sumber_id} not found",
        )

    wide_df = build_training_dataframe(
        kabupaten_kode=kabupaten_kode,
        periode_tipe=periode_tipe,
        sumber_id=sumber_id,
        change_pct_lags=2,
        reference_kabupaten_kodes=reference_kodes,
    )

    target_name = pangan_obj.nama
    tgt_col = _target_col(target_name)

    if wide_df.empty or tgt_col not in wide_df.columns:
        return TrainResult(
            pangan_id=pangan_id, kabupaten_kode=kabupaten_kode,
            periode_tipe=periode_tipe, artifact_path="",
            train_periods=0, last_snapshot_period_end=date.today(),
            eval_metrics={}, skipped=True,
            skip_reason="No snapshot data for this stream",
        )

    if len(wide_df) < min_periods:
        return TrainResult(
            pangan_id=pangan_id, kabupaten_kode=kabupaten_kode,
            periode_tipe=periode_tipe, artifact_path="",
            train_periods=len(wide_df), last_snapshot_period_end=date.today(),
            eval_metrics={}, skipped=True,
            skip_reason=f"Only {len(wide_df)} periods < min_periods={min_periods}",
        )

    last_period_end = wide_df["periode_end"].iloc[-1]
    if hasattr(last_period_end, "date"):
        last_period_end = last_period_end.date()
    elif isinstance(last_period_end, (int, np.integer)):
        last_period_end = date.fromordinal(int(last_period_end))

    models: dict[int, XGBRegressor] = {}
    eval_metrics: dict[int, dict[str, float]] = {}
    feature_names: list[str] | None = None

    # Collect per-fold evaluation data (deferred until artifact record exists)
    # Structure: {horizon: [(fold_no, idx_list, y_true_list, y_pred_list)]}
    per_horizon_fold_data: dict[int, list[tuple[int, list, list, list]]] = {}

    for h in range(1, max_horizon + 1):
        X, y = _build_feature_matrix(wide_df, target_name, h, max_horizon)

        if len(X) < max(10, min_periods // 2):
            continue

        if feature_names is None:
            feature_names = list(X.columns)

        # Walk-forward validation with 5 folds to get unbiased MAPE estimate
        # across different seasonal climates (Ramadan vs. off-peak vs. harvest).
        tscv = TimeSeriesSplit(n_splits=5, test_size=max(5, len(X) // 10))
        fold_y_true: list[float] = []
        fold_y_pred: list[float] = []
        fold_idx:    list[int]   = []

        per_fold: list[tuple[int, list, list, list]] = []

        for fold_no, (train_idx, val_idx) in enumerate(tscv.split(X), 1):
            _m = XGBRegressor(
                n_estimators=100, max_depth=4, learning_rate=0.1,
                subsample=0.8, colsample_bytree=0.8, random_state=42, verbosity=0,
            )
            _m.fit(X.iloc[train_idx], y.iloc[train_idx])
            v_idx  = X.iloc[val_idx].index.tolist()
            v_true = y.iloc[val_idx].tolist()
            v_pred = _m.predict(X.iloc[val_idx]).tolist()
            fold_y_true.extend(v_true)
            fold_y_pred.extend(v_pred)
            fold_idx.extend(v_idx)
            per_fold.append((fold_no, v_idx, v_true, v_pred))

        per_horizon_fold_data[h] = per_fold

        # Final model trained on ALL data — eval metrics come from fold predictions
        model = XGBRegressor(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            verbosity=0,
        )
        model.fit(X, y)
        models[h] = model

        # MAPE on reconstructed price level: pred_price = current * exp(log_return)
        harga_col = f"{target_name}_harga_lkv"
        if harga_col in wide_df.columns and fold_idx:
            idx_s   = pd.Index(fold_idx)
            cur_p   = wide_df.loc[idx_s, harga_col].values
            act_p   = wide_df[harga_col].shift(-h).loc[idx_s].values
            pred_p  = cur_p * np.exp(np.array(fold_y_pred))
            mask    = ~np.isnan(act_p) & (act_p > 0)
            mape_price = (
                float(np.mean(np.abs(act_p[mask] - pred_p[mask]) / act_p[mask]) * 100)
                if mask.any() else 0.0
            )
        else:
            mape_price = 0.0

        eval_metrics[h] = {
            "mae":        _mae(fold_y_true, fold_y_pred),
            "rmse":       _rmse(fold_y_true, fold_y_pred),
            "mape_price": mape_price,
        }

    if not models:
        return TrainResult(
            pangan_id=pangan_id, kabupaten_kode=kabupaten_kode,
            periode_tipe=periode_tipe, artifact_path="",
            train_periods=len(wide_df), last_snapshot_period_end=last_period_end,
            eval_metrics={}, skipped=True,
            skip_reason="No horizon models could be trained (insufficient data after feature alignment)",
        )

    artifact_dir = os.path.join(ARTIFACT_ROOT, periode_tipe, kabupaten_kode)
    os.makedirs(artifact_dir, exist_ok=True)
    artifact_path = os.path.join(artifact_dir, f"{pangan_id}.joblib")

    payload = {
        "models": models,
        "feature_names": feature_names or [],
        "pangan_id": pangan_id,
        "kabupaten_kode": kabupaten_kode,
        "periode_tipe": periode_tipe,
        "sumber_id": sumber_id,
        "reference_kodes": reference_kodes or [],
        "trained_at": date.today().isoformat(),
        "train_periods": len(wide_df),
        "last_snapshot_period_end": str(last_period_end),
        "eval_metrics": eval_metrics,
    }
    joblib.dump(payload, artifact_path)

    # Upsert PrediksiArtifact tracking row
    kab_obj = WilayahKabupaten.objects.get(kode_kabupaten=kabupaten_kode)
    artifact_rec, _ = PrediksiArtifact.objects.update_or_create(
        pangan=pangan_obj,
        kabupaten=kab_obj,
        periode_tipe=periode_tipe,
        defaults={
            "artifact_path": artifact_path,
            "trained_at": date.today(),
            "train_periods": len(wide_df),
            "last_snapshot_period_end": last_period_end,
            "eval_mae_h1":  Decimal(str(round(eval_metrics.get(1, {}).get("mae", 0), 4))),
            "eval_mae_h4":  Decimal(str(round(eval_metrics.get(max_horizon, {}).get("mae", 0), 4))),
            "eval_mape_h1": Decimal(str(round(eval_metrics.get(1, {}).get("mape_price", 0), 4))),
            "eval_mape_h4": Decimal(str(round(eval_metrics.get(max_horizon, {}).get("mape_price", 0), 4))),
            "eval_rmse_h1": Decimal(str(round(eval_metrics.get(1, {}).get("rmse", 0), 4))),
            "eval_rmse_h4": Decimal(str(round(eval_metrics.get(max_horizon, {}).get("rmse", 0), 4))),
            "is_available": True,
        },
    )

    # Persist per-row fold evaluation data (previously discarded)
    from sistem.models import ModelFoldEvaluation

    fold_evals: list[ModelFoldEvaluation] = []
    for h, folds in per_horizon_fold_data.items():
        target_periods = wide_df[
            ["periode_tahun", "periode_nomor", "periode_start", "periode_end"]
        ].shift(-h)
        hcol = f"{target_name}_harga_lkv"
        if hcol not in wide_df.columns:
            continue
        for fold_no, idx_list, y_true_list, y_pred_list in folds:
            cur_prices = wide_df.loc[idx_list, hcol].values.astype(float)
            act_prices = wide_df[hcol].shift(-h).loc[idx_list].values.astype(float)
            pred_prices = cur_prices * np.exp(np.array(y_pred_list, dtype=float))
            for i, idx_val in enumerate(idx_list):
                tp = target_periods.loc[idx_val]
                actual_price = act_prices[i]
                predicted_price = pred_prices[i]
                if np.isnan(actual_price) or actual_price <= 0:
                    continue
                abs_err = abs(actual_price - predicted_price) / actual_price * 100
                fold_evals.append(ModelFoldEvaluation(
                    artifact=artifact_rec,
                    horizon=h,
                    fold=fold_no,
                    periode_start=date.fromordinal(int(tp["periode_start"])) if pd.notna(tp["periode_start"]) else date.today(),
                    periode_end=date.fromordinal(int(tp["periode_end"])) if pd.notna(tp["periode_end"]) else date.today(),
                    periode_tahun=int(tp["periode_tahun"]) if pd.notna(tp["periode_tahun"]) else 0,
                    periode_nomor=int(tp["periode_nomor"]) if pd.notna(tp["periode_nomor"]) else 0,
                    actual_log_return=float(y_true_list[i]),
                    predicted_log_return=float(y_pred_list[i]),
                    actual_harga_lkv=float(actual_price),
                    predicted_harga_lkv=float(predicted_price),
                    abs_pct_error=float(abs_err),
                ))
    if fold_evals:
        ModelFoldEvaluation.objects.bulk_create(fold_evals, ignore_conflicts=True)

    return TrainResult(
        pangan_id=pangan_id,
        kabupaten_kode=kabupaten_kode,
        periode_tipe=periode_tipe,
        artifact_path=artifact_path,
        train_periods=len(wide_df),
        last_snapshot_period_end=last_period_end,
        eval_metrics=eval_metrics,
    )
