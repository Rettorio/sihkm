from __future__ import annotations

import calendar
from collections import deque
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import TYPE_CHECKING

from django.db.models import Max, Min

if TYPE_CHECKING:
    import pandas as pd


# ---------------------------------------------------------------------------
# Islamic / Christian calendar helpers for training features
# ---------------------------------------------------------------------------

_LEBARAN_DATES = [
    date(2020, 5, 24), date(2021, 5, 13), date(2022, 5,  2),
    date(2023, 4, 22), date(2024, 4, 10), date(2025, 3, 30),
    date(2026, 3, 19), date(2027, 3,  9), date(2028, 2, 26),
    date(2029, 2, 14), date(2030, 2,  3),
]


def _calendar_features(d) -> dict:
    """Proximity features to Lebaran and Christmas for a date or ordinal int."""
    if not isinstance(d, date):
        d = date.fromordinal(int(d))
    deltas = [(leb - d).days for leb in _LEBARAN_DATES]
    dtl = min(deltas, key=abs)
    xmas = date(d.year, 12, 25)
    dtx = (xmas - d).days
    if abs(dtx) > 182:
        alt = date(d.year + (1 if dtx < 0 else -1), 12, 25)
        dtx = (alt - d).days
    return {
        "cal_days_to_lebaran":   dtl,
        "cal_is_ramadan":        int(-30 <= dtl <= 0),
        "cal_is_post_lebaran":   int(0   <  dtl <= 14),
        "cal_days_to_christmas": dtx,
    }


# ---------------------------------------------------------------------------
# Period boundary helpers (moved from views.py; views.py imports from here)
# ---------------------------------------------------------------------------

BULAN_INDONESIA = [
    "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]


def _week_range(tahun, minggu):
    jan4 = date(tahun, 1, 4)
    start_of_week1 = jan4 - timedelta(days=jan4.isocalendar()[2] - 1)
    monday = start_of_week1 + timedelta(weeks=minggu - 1)
    return monday, monday + timedelta(days=4)


def _prev_week_range(tahun, minggu):
    if minggu > 1:
        return _week_range(tahun, minggu - 1)
    dec28 = date(tahun - 1, 12, 28)
    last_week = dec28.isocalendar()[1]
    return _week_range(tahun - 1, last_week)


def _month_range(tahun, bulan):
    start = date(tahun, bulan, 1)
    _, last = calendar.monthrange(tahun, bulan)
    return start, date(tahun, bulan, last)


def _prev_month_range(tahun, bulan):
    if bulan > 1:
        return _month_range(tahun, bulan - 1)
    return _month_range(tahun - 1, 12)


def _quarter_range(tahun, kuartal):
    sm = 3 * kuartal - 2
    em = 3 * kuartal
    _, last = calendar.monthrange(tahun, em)
    return date(tahun, sm, 1), date(tahun, em, last)


def _prev_quarter_range(tahun, kuartal):
    if kuartal > 1:
        return _quarter_range(tahun, kuartal - 1)
    return _quarter_range(tahun - 1, 4)


def _semester_range(tahun, semester):
    if semester == 1:
        return date(tahun, 1, 1), date(tahun, 6, 30)
    return date(tahun, 7, 1), date(tahun, 12, 31)


def _prev_semester_range(tahun, semester):
    if semester > 1:
        return _semester_range(tahun, semester - 1)
    return _semester_range(tahun - 1, 2)


def _year_range(tahun, _unused=None):
    return date(tahun, 1, 1), date(tahun, 12, 31)


def _prev_year_range(tahun, _unused=None):
    return _year_range(tahun - 1)


_PERIOD_FUNCS = {
    "weekly":     (_week_range,     _prev_week_range),
    "monthly":    (_month_range,    _prev_month_range),
    "quarterly":  (_quarter_range,  _prev_quarter_range),
    "semesterly": (_semester_range, _prev_semester_range),
    "yearly":     (_year_range,     _prev_year_range),
}


def resolve_period(mode, tahun, period_num):
    fn, prev_fn = _PERIOD_FUNCS[mode]
    start, end = fn(tahun, period_num)
    prev_start, prev_end = prev_fn(tahun, period_num)
    return start, end, prev_start, prev_end


def period_label(mode, tahun, period_num):
    if mode == "weekly":
        return f"Minggu {period_num} - {tahun}"
    if mode == "monthly":
        return f"{BULAN_INDONESIA[period_num]} {tahun}"
    if mode == "quarterly":
        return f"Kuartal {period_num} - {tahun}"
    if mode == "semesterly":
        return f"Semester {period_num} - {tahun}"
    return str(tahun)


def period_info(mode, tahun, period_num):
    if mode == "weekly":
        return {"tahun": tahun, "minggu": period_num, "label": period_label(mode, tahun, period_num)}
    if mode == "monthly":
        return {"tahun": tahun, "bulan": period_num, "label": period_label(mode, tahun, period_num)}
    if mode == "quarterly":
        return {"tahun": tahun, "kuartal": period_num, "label": period_label(mode, tahun, period_num)}
    if mode == "semesterly":
        return {"tahun": tahun, "semester": period_num, "label": period_label(mode, tahun, period_num)}
    return {"tahun": tahun, "label": period_label(mode, tahun, period_num)}


# ---------------------------------------------------------------------------
# Strategy pattern — bucket enumeration per period type
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Bucket:
    periode_tipe:  str
    periode_tahun: int
    periode_nomor: int
    start:         date
    end:           date


class PeriodStrategy:
    tipe: str

    def buckets_in_range(self, data_start: date, data_end: date) -> list[Bucket]:
        raise NotImplementedError

    def prev_bucket(self, bucket: Bucket) -> Bucket:
        raise NotImplementedError


class WeeklyStrategy(PeriodStrategy):
    tipe = "weekly"

    def buckets_in_range(self, data_start: date, data_end: date) -> list[Bucket]:
        buckets = []
        # walk from the ISO week containing data_start up to data_end
        current = data_start
        seen = set()
        while current <= data_end:
            iso_year, iso_week, _ = current.isocalendar()
            if (iso_year, iso_week) not in seen:
                seen.add((iso_year, iso_week))
                wstart, wend = _week_range(iso_year, iso_week)
                if wstart <= data_end:
                    buckets.append(Bucket(self.tipe, iso_year, iso_week, wstart, wend))
            current += timedelta(days=7)
        return buckets

    def prev_bucket(self, bucket: Bucket) -> Bucket:
        tahun, nomor = bucket.periode_tahun, bucket.periode_nomor
        p_start, p_end = _prev_week_range(tahun, nomor)
        p_year, p_week, _ = p_end.isocalendar()
        return Bucket(self.tipe, p_year, p_week, p_start, p_end)


class MonthlyStrategy(PeriodStrategy):
    tipe = "monthly"

    def buckets_in_range(self, data_start: date, data_end: date) -> list[Bucket]:
        buckets = []
        year, month = data_start.year, data_start.month
        while True:
            mstart, mend = _month_range(year, month)
            if mend > data_end:
                break
            buckets.append(Bucket(self.tipe, year, month, mstart, mend))
            month += 1
            if month > 12:
                month = 1
                year += 1
        return buckets

    def prev_bucket(self, bucket: Bucket) -> Bucket:
        tahun, nomor = bucket.periode_tahun, bucket.periode_nomor
        p_start, p_end = _prev_month_range(tahun, nomor)
        p_month = p_end.month
        p_year = p_end.year
        return Bucket(self.tipe, p_year, p_month, p_start, p_end)


class QuarterlyStrategy(PeriodStrategy):
    tipe = "quarterly"

    def buckets_in_range(self, data_start: date, data_end: date) -> list[Bucket]:
        buckets = []
        year = data_start.year
        quarter = (data_start.month - 1) // 3 + 1
        while True:
            qstart, qend = _quarter_range(year, quarter)
            if qend > data_end:
                break
            buckets.append(Bucket(self.tipe, year, quarter, qstart, qend))
            quarter += 1
            if quarter > 4:
                quarter = 1
                year += 1
        return buckets

    def prev_bucket(self, bucket: Bucket) -> Bucket:
        tahun, nomor = bucket.periode_tahun, bucket.periode_nomor
        p_start, p_end = _prev_quarter_range(tahun, nomor)
        p_quarter = (p_end.month - 1) // 3 + 1
        return Bucket(self.tipe, p_end.year, p_quarter, p_start, p_end)


class SemesterlyStrategy(PeriodStrategy):
    tipe = "semesterly"

    def buckets_in_range(self, data_start: date, data_end: date) -> list[Bucket]:
        buckets = []
        year = data_start.year
        semester = 1 if data_start.month <= 6 else 2
        while True:
            sstart, send = _semester_range(year, semester)
            if send > data_end:
                break
            buckets.append(Bucket(self.tipe, year, semester, sstart, send))
            semester += 1
            if semester > 2:
                semester = 1
                year += 1
        return buckets

    def prev_bucket(self, bucket: Bucket) -> Bucket:
        tahun, nomor = bucket.periode_tahun, bucket.periode_nomor
        p_start, p_end = _prev_semester_range(tahun, nomor)
        p_semester = 1 if p_end.month <= 6 else 2
        return Bucket(self.tipe, p_end.year, p_semester, p_start, p_end)


STRATEGIES: dict[str, PeriodStrategy] = {
    "weekly":     WeeklyStrategy(),
    "monthly":    MonthlyStrategy(),
    "quarterly":  QuarterlyStrategy(),
    "semesterly": SemesterlyStrategy(),
}


# ---------------------------------------------------------------------------
# Core LPIT lookup
# ---------------------------------------------------------------------------

def _lkv_for_bucket(pangan_id: int, kabupaten_kode: str, bucket_end: date):
    """Return the HargaPangan row with max(tanggal_update) <= bucket_end for this stream.
    No lower bound — intentional, to allow LOCF across long gaps without data leakage.
    Rows with harga_sekarang=0 are excluded: SP2KP sends 0 for holiday/gap days which
    should be treated as missing data, not as a real price."""
    from sistem.models import HargaPangan
    return (
        HargaPangan.objects
        .filter(
            pangan_id=pangan_id,
            kabupaten__kode_kabupaten=kabupaten_kode,
            tanggal_update__lte=bucket_end,
            harga_sekarang__gt=0,
        )
        .order_by("-tanggal_update")
        .first()
    )


# ---------------------------------------------------------------------------
# Wholesale-market LKV lookup
# ---------------------------------------------------------------------------

def _lkv_for_bucket_market(pangan_id: int, pasar_id: int, bucket_end: date):
    """Return the HargaPanganWholesaleMarket row with max(tanggal_update) <= bucket_end."""
    from sistem.models import HargaPanganWholesaleMarket
    return (
        HargaPanganWholesaleMarket.objects
        .filter(
            pangan_id=pangan_id,
            pasar_id=pasar_id,
            tanggal_update__lte=bucket_end,
        )
        .order_by("-tanggal_update")
        .first()
    )


# ---------------------------------------------------------------------------
# Aggregator
# ---------------------------------------------------------------------------

_UPSERT_UPDATE_FIELDS = [
    "periode_start", "periode_end",
    "harga_lkv", "tanggal_lkv", "is_locf",
    "harga_lkv_prev", "harga_delta", "change_pct", "is_up",
    "harga_lag1", "harga_lag2", "harga_lag3",
    "updated_at",
]

# Both regency-level (pasar=NULL) and per-market (pasar=id) snapshots share
# the same DB unique constraint — must include "pasar" in both cases.
_UPSERT_UNIQUE_FIELDS = [
    "pangan", "kabupaten", "pasar", "periode_tipe",
    "periode_tahun", "periode_nomor",
]

_QUANTIZE_PCT = Decimal("0.0001")


class LPITAggregator:

    # ---- public entry points ----

    def run_full_rebuild(
        self,
        periode_tipe: str,
        sumber_id: int | None = None,
        tipe_pasar: int | None = None,
    ) -> dict:
        from sistem.models import HargaPangan, HargaSnapshot, Pangan, WilayahKabupaten

        strategy = STRATEGIES[periode_tipe]

        qs_filter = {}
        if sumber_id is not None:
            qs_filter["pangan__sumber_id"] = sumber_id

        if tipe_pasar == 3:
            from sistem.models import HargaPanganWholesaleMarket
            agg = HargaPanganWholesaleMarket.objects.filter(**qs_filter).aggregate(
                min_date=Min("tanggal_update"),
                max_date=Max("tanggal_update"),
            )
        else:
            agg = HargaPangan.objects.filter(**qs_filter).aggregate(
                min_date=Min("tanggal_update"),
                max_date=Max("tanggal_update"),
            )
        if not agg["min_date"]:
            return {"created": 0, "updated": 0}

        data_start: date = agg["min_date"]
        data_end:   date = agg["max_date"]
        buckets = strategy.buckets_in_range(data_start, data_end)
        if not buckets:
            return {"created": 0, "updated": 0}

        snap_filter = {"periode_tipe": periode_tipe}
        if sumber_id is not None:
            snap_filter["pangan__sumber_id"] = sumber_id

        if tipe_pasar == 3:
            snap_filter["pasar__isnull"] = False
        else:
            snap_filter["pasar__isnull"] = True

        HargaSnapshot.objects.filter(**snap_filter).delete()

        pangan_qs = Pangan.objects.all()
        if sumber_id is not None:
            pangan_qs = pangan_qs.filter(sumber_id=sumber_id)
        kabupaten_qs = WilayahKabupaten.objects.all()

        # ── Per-market snapshots (wholesale) ────────────────────────────
        if tipe_pasar == 3:
            return self._run_full_rebuild_markets(
                pangan_qs, sumber_id, strategy, buckets, periode_tipe,
            )

        # ── Regency-level snapshots (existing behaviour) ────────────────
        # Flush per (pangan, kabupaten) pair to keep peak memory bounded.
        created = updated = 0
        for pangan in pangan_qs:
            for kabupaten in kabupaten_qs:
                snaps = self.aggregate_stream(pangan, kabupaten, strategy, buckets)
                c, u = self._upsert_snapshots(snaps)
                created += c
                updated += u

        return {"created": created, "updated": updated}

    def _run_full_rebuild_markets(
        self,
        pangan_qs,
        sumber_id: int | None,
        strategy: PeriodStrategy,
        buckets: list[Bucket],
        periode_tipe: str,
    ) -> dict:
        from sistem.models import HargaSnapshot, WilayahPasar

        pasar_qs = WilayahPasar.objects.filter(tipe_pasar=3).select_related("kabupaten")
        created = updated = 0
        for pangan in pangan_qs:
            for pasar in pasar_qs:
                snaps = self.aggregate_stream(
                    pangan, pasar.kabupaten, strategy, buckets, pasar=pasar,
                )
                c, u = self._upsert_snapshots(snaps, unique_fields=_UPSERT_UNIQUE_FIELDS)
                created += c
                updated += u

        return {"created": created, "updated": updated}

    def run_incremental(
        self,
        periode_tipe: str,
        from_date: date,
        sumber_id: int | None = None,
        tipe_pasar: int | None = None,
    ) -> dict:
        from sistem.models import HargaPangan, HargaSnapshot, Pangan, WilayahKabupaten

        strategy = STRATEGIES[periode_tipe]

        agg = HargaPangan.objects.aggregate(max_date=Max("tanggal_update"))
        data_end: date | None = agg["max_date"]

        if tipe_pasar == 3:
            from sistem.models import HargaPanganWholesaleMarket
            mkt_agg = HargaPanganWholesaleMarket.objects.aggregate(max_date=Max("tanggal_update"))
            mkt_end: date | None = mkt_agg["max_date"]
            if mkt_end and (not data_end or mkt_end > data_end):
                data_end = mkt_end

        if not data_end:
            return {"created": 0, "updated": 0}

        buckets = [b for b in strategy.buckets_in_range(from_date, data_end)
                   if b.end >= from_date]
        if not buckets:
            return {"created": 0, "updated": 0}

        pangan_qs = Pangan.objects.all()
        if sumber_id is not None:
            pangan_qs = pangan_qs.filter(sumber_id=sumber_id)
        kabupaten_qs = WilayahKabupaten.objects.all()

        # ── Per-market snapshots (wholesale) ────────────────────────────
        if tipe_pasar == 3:
            return self._run_incremental_markets(
                pangan_qs, sumber_id, strategy, buckets, from_date, periode_tipe,
            )

        # ── Regency-level snapshots (existing behaviour) ────────────────
        # Flush per (pangan, kabupaten) pair to keep peak memory bounded.
        created = updated = 0
        for pangan in pangan_qs:
            for kabupaten in kabupaten_qs:
                seed = self._load_preceding_state(
                    pangan.id, kabupaten.kode_kabupaten, periode_tipe, buckets[0]
                )
                snaps = self.aggregate_stream(
                    pangan, kabupaten, strategy, buckets, seed_snapshot=seed
                )
                c, u = self._upsert_snapshots(snaps)
                created += c
                updated += u

        return {"created": created, "updated": updated}

    def _run_incremental_markets(
        self,
        pangan_qs,
        sumber_id: int | None,
        strategy: PeriodStrategy,
        buckets: list[Bucket],
        from_date: date,
        periode_tipe: str,
    ) -> dict:
        from sistem.models import HargaSnapshot, WilayahPasar

        pasar_qs = WilayahPasar.objects.filter(tipe_pasar=3).select_related("kabupaten")
        created = updated = 0
        for pangan in pangan_qs:
            for pasar in pasar_qs:
                seed = self._load_preceding_state(
                    pangan.id, pasar.kabupaten.kode_kabupaten, periode_tipe, buckets[0],
                    pasar=pasar,
                )
                snaps = self.aggregate_stream(
                    pangan, pasar.kabupaten, strategy, buckets,
                    seed_snapshot=seed, pasar=pasar,
                )
                c, u = self._upsert_snapshots(snaps, unique_fields=_UPSERT_UNIQUE_FIELDS)
                created += c
                updated += u

        return {"created": created, "updated": updated}

    # ---- stream aggregation ----

    def aggregate_stream(
        self,
        pangan,
        kabupaten,
        strategy: PeriodStrategy,
        buckets: list[Bucket],
        seed_snapshot=None,
        pasar=None,
    ) -> list:
        from sistem.models import HargaSnapshot

        sorted_buckets = sorted(buckets, key=lambda b: b.end)

        if seed_snapshot is not None:
            prev_price: Decimal | None = seed_snapshot.harga_lkv
            prev_tanggal: date | None = seed_snapshot.tanggal_lkv
            lag_init = [seed_snapshot.harga_lag1, seed_snapshot.harga_lag2, seed_snapshot.harga_lag3]
            lag_history: deque = deque(
                (v for v in lag_init if v is not None),
                maxlen=3,
            )
            lag_history.append(seed_snapshot.harga_lkv)
        else:
            prev_price = None
            prev_tanggal = None
            lag_history = deque(maxlen=3)

        snapshots = []

        for bucket in sorted_buckets:
            if pasar is not None:
                row = _lkv_for_bucket_market(pangan.id, pasar.id, bucket.end)
            else:
                row = _lkv_for_bucket(pangan.id, kabupaten.kode_kabupaten, bucket.end)

            if row is None and prev_price is None:
                continue

            is_locf = row is None
            if is_locf:
                lkv_price = prev_price
                lkv_date  = prev_tanggal
            else:
                lkv_price = Decimal(str(row.harga if pasar is not None else row.harga_sekarang))
                lkv_date  = row.tanggal_update

            if prev_price is not None:
                harga_delta = lkv_price - prev_price
                if prev_price != 0:
                    change_pct = (harga_delta / prev_price * 100).quantize(
                        _QUANTIZE_PCT, rounding=ROUND_HALF_UP
                    )
                else:
                    change_pct = None
                is_up = harga_delta > 0
            else:
                harga_delta = None
                change_pct  = None
                is_up       = None

            lag_list = list(lag_history)
            lag1 = lag_list[-1] if len(lag_list) >= 1 else None
            lag2 = lag_list[-2] if len(lag_list) >= 2 else None
            lag3 = lag_list[-3] if len(lag_list) >= 3 else None

            snapshots.append(HargaSnapshot(
                pangan=pangan,
                kabupaten=kabupaten,
                pasar=pasar,
                periode_tipe=bucket.periode_tipe,
                periode_tahun=bucket.periode_tahun,
                periode_nomor=bucket.periode_nomor,
                periode_start=bucket.start,
                periode_end=bucket.end,
                harga_lkv=lkv_price,
                tanggal_lkv=lkv_date,
                is_locf=is_locf,
                harga_lkv_prev=prev_price,
                harga_delta=harga_delta,
                change_pct=change_pct,
                is_up=is_up,
                harga_lag1=lag1,
                harga_lag2=lag2,
                harga_lag3=lag3,
            ))

            prev_price  = lkv_price
            prev_tanggal = lkv_date
            lag_history.append(lkv_price)

        return snapshots

    def _load_preceding_state(
        self,
        pangan_id: int,
        kabupaten_kode: str,
        periode_tipe: str,
        first_affected_bucket: Bucket,
        pasar=None,
    ):
        """Return the snapshot immediately before first_affected_bucket to seed incremental runs."""
        from sistem.models import HargaSnapshot
        filters = {
            "pangan_id": pangan_id,
            "kabupaten__kode_kabupaten": kabupaten_kode,
            "periode_tipe": periode_tipe,
            "periode_end__lt": first_affected_bucket.start,
        }
        if pasar is not None:
            filters["pasar"] = pasar
        else:
            filters["pasar__isnull"] = True
        return (
            HargaSnapshot.objects
            .filter(**filters)
            .order_by("-periode_end")
            .first()
        )

    def _upsert_snapshots(
        self,
        snapshots: list,
        unique_fields: list[str] | None = None,
    ) -> tuple[int, int]:
        from sistem.models import HargaSnapshot

        if not snapshots:
            return 0, 0

        BATCH = 500
        created_total = 0
        updated_total = 0

        if unique_fields is None:
            unique_fields = _UPSERT_UNIQUE_FIELDS

        for i in range(0, len(snapshots), BATCH):
            batch = snapshots[i : i + BATCH]
            results = HargaSnapshot.objects.bulk_create(
                batch,
                update_conflicts=True,
                unique_fields=unique_fields,
                update_fields=_UPSERT_UPDATE_FIELDS,
            )
            # Django sets pk on newly created rows; updated rows already have pk
            for obj in results:
                if obj.pk is None or not hasattr(obj, "_state") or obj._state.adding:
                    created_total += 1
                else:
                    updated_total += 1

        return created_total, updated_total


# ---------------------------------------------------------------------------
# Wide-format pivot for XGBoost feature extraction
# ---------------------------------------------------------------------------

def build_wide_dataframe(
    kabupaten_kode: str,
    periode_tipe: str,
    periode_tahun: int | None = None,
    sumber_id: int | None = None,
) -> "pd.DataFrame":
    """
    Pivot HargaSnapshot rows into one row per (kabupaten, periode_tahun, periode_nomor),
    one column per commodity. Suitable for XGBoost training.
    """
    import pandas as pd
    from sistem.models import HargaSnapshot

    filters = {
        "kabupaten__kode_kabupaten": kabupaten_kode,
        "periode_tipe": periode_tipe,
    }
    if periode_tahun is not None:
        filters["periode_tahun"] = periode_tahun
    if sumber_id is not None:
        filters["pangan__sumber_id"] = sumber_id

    qs = (
        HargaSnapshot.objects
        .filter(**filters)
        .select_related("pangan")
        .order_by("periode_tahun", "periode_nomor", "pangan__nama")
        .values(
            "periode_tahun", "periode_nomor", "periode_start", "periode_end",
            "pangan__nama",
            "harga_lkv", "harga_delta", "change_pct",
            "harga_lag1", "harga_lag2", "harga_lag3",
            "is_locf", "is_up",
        )
    )

    df_long = pd.DataFrame.from_records(list(qs))
    if df_long.empty:
        return df_long

    index_cols = ["periode_tahun", "periode_nomor", "periode_start", "periode_end"]
    value_cols = ["harga_lkv", "harga_delta", "change_pct", "harga_lag1", "harga_lag2", "harga_lag3"]

    frames = []
    for col in value_cols:
        pivot = df_long.pivot_table(
            index=index_cols,
            columns="pangan__nama",
            values=col,
            aggfunc="first",
        )
        pivot.columns = [f"{c}_{col}" for c in pivot.columns]
        frames.append(pivot)

    wide = pd.concat(frames, axis=1).reset_index()
    wide = wide.sort_values(["periode_tahun", "periode_nomor"]).reset_index(drop=True)
    return wide


# ---------------------------------------------------------------------------
# Training-ready DataFrame (extends build_wide_dataframe for ML use)
# ---------------------------------------------------------------------------

def build_training_dataframe(
    kabupaten_kode: str,
    periode_tipe: str,
    sumber_id: int | None = None,
    change_pct_lags: int = 2,
    reference_kabupaten_kodes: "list[str] | None" = None,
) -> "pd.DataFrame":
    """
    Training-ready variant of build_wide_dataframe.

    Extends the base wide DataFrame with:
    - {commodity}_change_pct_lag1 … lagN  — lagged % change for each commodity
    - {commodity}_is_locf                 — 0/1 flag for forward-filled rows
    - {commodity}_change_pct_ref_{kode}   — change_pct from reference/producer cities

    Cross-commodity and cross-city NaN values are filled with 0 so that rows
    with target data are not dropped due to peripheral commodity gaps.

    build_wide_dataframe is untouched; this function is the only entry point
    for the training pipeline.
    """
    import pandas as pd
    from sistem.models import HargaSnapshot

    _INDEX_COLS = ["periode_tahun", "periode_nomor", "periode_start", "periode_end"]

    # Step 1: base wide DataFrame
    wide = build_wide_dataframe(
        kabupaten_kode=kabupaten_kode,
        periode_tipe=periode_tipe,
        sumber_id=sumber_id,
    )
    if wide.empty:
        return wide

    # Step 2: lagged change_pct columns (df already sorted by period)
    for col in list(wide.columns):
        if col.endswith("_change_pct"):
            for lag in range(1, change_pct_lags + 1):
                wide[f"{col}_lag{lag}"] = wide[col].shift(lag)

    # Step 3: is_locf flag columns via a lightweight extra query
    locf_filters: dict = {
        "kabupaten__kode_kabupaten": kabupaten_kode,
        "periode_tipe": periode_tipe,
    }
    if sumber_id is not None:
        locf_filters["pangan__sumber_id"] = sumber_id

    qs_locf = (
        HargaSnapshot.objects
        .filter(**locf_filters)
        .select_related("pangan")
        .values("periode_tahun", "periode_nomor", "pangan__nama", "is_locf")
    )
    df_locf = pd.DataFrame.from_records(list(qs_locf))
    if not df_locf.empty:
        locf_pivot = df_locf.pivot_table(
            index=["periode_tahun", "periode_nomor"],
            columns="pangan__nama",
            values="is_locf",
            aggfunc="first",
        ).astype("float64").fillna(0.0).astype("int64")
        locf_pivot.columns = [f"{c}_is_locf" for c in locf_pivot.columns]
        locf_pivot = locf_pivot.reset_index()
        wide = wide.merge(locf_pivot, on=["periode_tahun", "periode_nomor"], how="left")

    # Step 3b: LOCF streak — consecutive periods with carried-forward price.
    # A long streak signals a pending price update (rebound bias).
    for col in [c for c in wide.columns if c.endswith("_is_locf")]:
        com = col[: -len("_is_locf")]
        streak, count = [], 0
        for val in wide[col]:
            count = count + 1 if val else 0
            streak.append(count)
        wide[f"{com}_locf_streak"] = streak

    # Step 4: cross-city reference features
    for ref_kode in (reference_kabupaten_kodes or []):
        if ref_kode == kabupaten_kode:
            continue
        ref_wide = build_wide_dataframe(
            kabupaten_kode=ref_kode,
            periode_tipe=periode_tipe,
            sumber_id=sumber_id,
        )
        if ref_wide.empty:
            continue
        ref_change_cols = [c for c in ref_wide.columns if c.endswith("_change_pct")]
        ref_lkv_cols   = [c for c in ref_wide.columns if c.endswith("_harga_lkv")]
        ref_export     = ref_change_cols + ref_lkv_cols
        ref_subset = ref_wide[["periode_tahun", "periode_nomor"] + ref_export].rename(
            columns={c: f"{c}_ref_{ref_kode}" for c in ref_export}
        )
        wide = wide.merge(ref_subset, on=["periode_tahun", "periode_nomor"], how="left")

    # Step 4b: Spatial lag for reference city change_pct features.
    # Shipping from Surabaya/Makassar to Maluku takes ~7–14 days, so the lagged
    # reference price is the actual causal signal, not the contemporaneous one.
    _ref_chg_cols = [
        c for c in wide.columns
        if "_change_pct_ref_" in c and "_lag" not in c and "_vol" not in c
    ]
    for col in _ref_chg_cols:
        for lag in (1, 2):
            wide[f"{col}_lag{lag}"] = wide[col].shift(lag)

    # Step 4c: Rolling volatility of reference city prices — logistics disruption proxy.
    # High variance in producer-city prices signals impending supply chain shocks.
    for col in _ref_chg_cols:
        wide[f"{col}_vol3"] = wide[col].rolling(3, min_periods=1).std().fillna(0)

    # Step 5: One-Hot Encode periode_nomor (seasonality categories).
    # Treating it as a numeric integer forces an ordinal assumption (week 52 > week 1)
    # that does not hold for price seasonality. OHE gives XGBoost an explicit binary
    # signal per bucket (e.g. period_num_11, period_num_12 for Ramadan/Eid months).
    # sin/cos encoding adds circular awareness (week 52 ≈ week 1) that OHE misses.
    import numpy as _np
    ohe = pd.get_dummies(wide["periode_nomor"].astype(int), prefix="period_num", dtype=int)
    wide = pd.concat([wide, ohe], axis=1)
    _n_periods = {"weekly": 52, "monthly": 12, "quarterly": 4, "semesterly": 2}.get(periode_tipe, 52)
    _pf = wide["periode_nomor"].astype(float)
    wide["sin_period"] = _np.sin(2 * _np.pi * _pf / _n_periods)
    wide["cos_period"] = _np.cos(2 * _np.pi * _pf / _n_periods)

    # Step 5b: Islamic and Christian calendar proximity features.
    # Uses periode_end while it is still a date object (before Step 6 ordinal cast).
    cal_df = pd.DataFrame(
        [_calendar_features(row) for row in wide["periode_end"]],
        index=wide.index,
    )
    wide = pd.concat([wide, cal_df], axis=1)

    # Step 6: Cast date columns to integer ordinal (days since 0001-01-01).
    # datetime.date objects stored as object dtype must become int64 so XGBoost
    # can consume them. date.toordinal() is stdlib — no extra dependency.
    for date_col in ("periode_start", "periode_end"):
        if date_col in wide.columns:
            wide[date_col] = wide[date_col].apply(
                lambda v: v.toordinal() if hasattr(v, "toordinal") else int(v)
            )

    # Step 7: Cast all remaining object columns (Django Decimal, shifted Decimal,
    # ref-city Decimal) to float64, then fill any NaN with 0.0.
    # fillna is done AFTER cast so the sentinel is a proper float, not a mixed-type int.
    obj_cols = wide.select_dtypes(include="object").columns
    if len(obj_cols):
        wide[obj_cols] = wide[obj_cols].apply(pd.to_numeric, errors="coerce")
    data_cols = [c for c in wide.columns if c not in _INDEX_COLS]
    wide[data_cols] = wide[data_cols].fillna(0.0)

    # Step 8: Mean-reversion feature — price relative to government reference price.
    # Must run after Step 7 so harga_lkv is already float64.
    # If price is 40% above harga_acuan, a negative return is overdue.
    from sistem.models import Pangan as _Pangan
    acuan_map = dict(
        _Pangan.objects.filter(sumber_id=sumber_id or 1)
        .values_list("nama", "harga_acuan")
    )
    acuan_cols: dict[str, pd.Series] = {}
    for com, acuan in acuan_map.items():
        harga_col = f"{com}_harga_lkv"
        if harga_col in wide.columns and acuan:
            acuan_cols[f"{com}_price_to_acuan"] = wide[harga_col] / float(acuan)
    if acuan_cols:
        wide = pd.concat([wide, pd.DataFrame(acuan_cols, index=wide.index)], axis=1)

    return wide
