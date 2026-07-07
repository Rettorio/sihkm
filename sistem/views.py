from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from django.db.models import Max
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from sistem.models import (
    HargaPangan, HargaPanganWholesaleMarket, HargaSnapshot,
    Pangan, WilayahKabupaten, WilayahPasar,
)
from sistem.serializers import (
    HargaSnapshotSerializer,
    HargaUpdateRequestSerializer,
    KabupatenGeoJSONSerializer,
    KabupatenSerializer,
    KomoditasSerializer,
    PasarSerializer,
    PrediksiResultSerializer,
)
from sistem.services.predictor import ModelNotAvailable, predict as prediksi_predict
from sistem.services.aggregator import (
    _week_range,
    period_info,
    period_label,
    resolve_period,
    build_wide_dataframe,
)


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def _latest_price_per_kab(komoditas_id, tipe_pasar, start, end):
    qs = (
        HargaPangan.objects
        .filter(
            pangan__master_id=komoditas_id,
            pangan__sumber_id=tipe_pasar,
            tanggal_update__gte=start,
            tanggal_update__lte=end,
            harga_sekarang__gt=0,
        )
        .select_related("kabupaten")
        .order_by("kabupaten__kode_kabupaten", "-tanggal_update")
    )
    result = {}
    for row in qs:
        kode = row.kabupaten.kode_kabupaten
        if kode not in result:
            result[kode] = {
                "harga": float(row.harga_sekarang),
                "tanggal": row.tanggal_update,
            }
    return result


def _latest_price_simple(komoditas_id, tipe_pasar, start, end):
    qs = (
        HargaPangan.objects
        .filter(
            pangan__master_id=komoditas_id,
            pangan__sumber_id=tipe_pasar,
            tanggal_update__gte=start,
            tanggal_update__lte=end,
            harga_sekarang__gt=0,
        )
        .select_related("kabupaten")
        .order_by("kabupaten__kode_kabupaten", "-tanggal_update")
    )
    result = {}
    for row in qs:
        kode = row.kabupaten.kode_kabupaten
        if kode not in result:
            result[kode] = float(row.harga_sekarang)
    return result


def _build_peta_from_snapshot(pangan_id, mode, tahun, period_num, kabupaten_qs):
    """Single indexed snapshot read → peta list, or None if no snapshot exists for this period."""
    rows = list(
        HargaSnapshot.objects
        .filter(
            pangan_id=pangan_id,
            pasar__isnull=True,
            periode_tipe=mode,
            periode_tahun=tahun,
            periode_nomor=period_num,
        )
        .values('kabupaten__kode_kabupaten', 'harga_lkv', 'harga_lkv_prev', 'change_pct', 'is_up', 'tanggal_lkv')
    )
    if not rows:
        return None  # signal caller to fall back to raw queries

    snap_map = {r['kabupaten__kode_kabupaten']: r for r in rows}
    peta = []
    for kab in kabupaten_qs:
        kode = kab.kode_kabupaten
        s = snap_map.get(kode)
        entry = {"kode": kode, "nama": kab.nama}
        if s:
            entry.update({
                "harga":          float(s['harga_lkv']),
                "harga_terakhir": float(s['harga_lkv_prev']) if s['harga_lkv_prev'] is not None else None,
                "change_pct":     round(float(s['change_pct']), 2) if s['change_pct'] is not None else None,
                "is_up":          s['is_up'],
                "tanggal":        s['tanggal_lkv'].strftime("%d-%m-%Y"),
            })
        else:
            entry.update({"harga": None, "harga_terakhir": None, "change_pct": None, "is_up": None, "tanggal": None})
        peta.append(entry)
    return peta


def _build_peta_raw(kabupaten_qs, current, previous):
    """Build peta list from raw _latest_price_per_kab / _latest_price_simple dicts."""
    peta = []
    for kab in kabupaten_qs:
        kode = kab.kode_kabupaten
        cur    = current.get(kode)
        prev_h = previous.get(kode)
        entry  = {"kode": kode, "nama": kab.nama}
        if cur is not None:
            h = cur["harga"]
            change_pct = round((h - prev_h) / prev_h * 100, 2) if prev_h else None
            entry.update({
                "harga":          h,
                "harga_terakhir": prev_h,
                "change_pct":     change_pct,
                "is_up":          (h > prev_h) if prev_h is not None else None,
                "tanggal":        cur["tanggal"].strftime("%d-%m-%Y"),
            })
        else:
            entry.update({"harga": None, "harga_terakhir": None, "change_pct": None, "is_up": None, "tanggal": None})
        peta.append(entry)
    return peta


# ---------------------------------------------------------------------------
# Existing simple views (unchanged)
# ---------------------------------------------------------------------------

class KabupatenListView(generics.ListAPIView):
    queryset = WilayahKabupaten.objects.order_by("nama")
    serializer_class = KabupatenSerializer


class KomoditasListView(generics.ListAPIView):
    serializer_class = KomoditasSerializer

    def get_queryset(self):
        qs = Pangan.objects.order_by("nama")
        sumber_id = self.request.query_params.get("sumber_id")
        if sumber_id is not None:
            try:
                qs = qs.filter(sumber_id=int(sumber_id))
            except ValueError:
                pass
        return qs


class KabupatenGeoJSONView(generics.ListAPIView):
    queryset = WilayahKabupaten.objects.all()
    serializer_class = KabupatenGeoJSONSerializer


# ---------------------------------------------------------------------------
# HargaPetaView  —  GET /api/harga/peta/
# ---------------------------------------------------------------------------

class HargaPetaView(APIView):
    MODES = frozenset(["daily", "weekly", "monthly", "quarterly", "semesterly", "yearly"])

    def get(self, request):
        komoditas_id = request.query_params.get("komoditas_id")
        if not komoditas_id:
            return Response({"error": "komoditas_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        komoditas_id = str(komoditas_id)

        try:
            tipe_pasar = int(request.query_params.get("tipe_pasar", 1))
        except ValueError:
            return Response({"error": "tipe_pasar must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        mode = request.query_params.get("mode")
        if mode is None:
            mode = "daily" if "tanggal" in request.query_params else "weekly"
        if mode not in self.MODES:
            return Response({"error": f"mode must be one of: {', '.join(sorted(self.MODES))}"}, status=status.HTTP_400_BAD_REQUEST)

        resolution = self._resolve_bounds(mode, komoditas_id, tipe_pasar, request.query_params)
        if resolution is None:
            return Response([], status=status.HTTP_200_OK)

        bounds, tahun, period_num = resolution
        start, end, prev_start, prev_end = bounds
        kabupaten_qs = list(WilayahKabupaten.objects.order_by("nama"))

        # Try Gold table first for non-daily modes (single indexed read)
        peta = None
        if mode != "daily" and tahun is not None and period_num is not None:
            pangan_obj = Pangan.objects.filter(master_id=komoditas_id, sumber_id=tipe_pasar).first()
            if pangan_obj:
                peta = _build_peta_from_snapshot(pangan_obj.pk, mode, tahun, period_num, kabupaten_qs)

        if peta is None:
            current  = _latest_price_per_kab(komoditas_id, tipe_pasar, start, end)
            previous = _latest_price_simple(komoditas_id, tipe_pasar, prev_start, prev_end)
            peta     = _build_peta_raw(kabupaten_qs, current, previous)

        return Response(peta)

    def _resolve_bounds(self, mode, komoditas_id, tipe_pasar, params):
        """Returns (bounds, tahun, period_num) or None on failure. tahun/period_num are None for daily."""
        if mode == "daily":
            tanggal_str = params.get("tanggal")
            if tanggal_str:
                try:
                    tanggal = datetime.strptime(tanggal_str, "%d-%m-%Y").date()
                except ValueError:
                    return None
            else:
                tanggal = self._latest_date(komoditas_id, tipe_pasar)
                if tanggal is None:
                    return None
            return (tanggal, tanggal, tanggal - timedelta(days=1), tanggal - timedelta(days=1)), None, None

        tahun_str = params.get("tahun")
        if tahun_str:
            try:
                tahun = int(tahun_str)
            except ValueError:
                return None
        else:
            latest = self._latest_date(komoditas_id, tipe_pasar)
            if latest is None:
                return None
            tahun = latest.year

        period_num = self._extract_period(mode, params, tahun, komoditas_id, tipe_pasar)
        if period_num is None:
            return None

        bounds = resolve_period(mode, tahun, period_num)
        if bounds is None:
            return None
        return bounds, tahun, period_num

    def _latest_date(self, komoditas_id, tipe_pasar):
        return (
            HargaPangan.objects
            .filter(pangan__master_id=komoditas_id, pangan__sumber_id=tipe_pasar, harga_sekarang__gt=0)
            .aggregate(Max("tanggal_update"))["tanggal_update__max"]
        )

    def _extract_period(self, mode, params, tahun, komoditas_id, tipe_pasar):
        if mode == "yearly":
            return tahun

        param_name = {"weekly": "minggu", "monthly": "bulan", "quarterly": "kuartal", "semesterly": "semester"}[mode]
        val = params.get(param_name)
        if val is not None:
            try:
                return int(val)
            except ValueError:
                return None

        latest = self._latest_date(komoditas_id, tipe_pasar)
        if latest is None:
            return None
        if mode == "weekly":
            return latest.isocalendar()[1]
        if mode == "monthly":
            return latest.month
        if mode == "quarterly":
            return (latest.month - 1) // 3 + 1
        return 1 if latest.month <= 6 else 2


# ---------------------------------------------------------------------------
# HargaPetaOptionsView  —  GET /api/harga/peta/options/
# ---------------------------------------------------------------------------

class HargaPetaOptionsView(APIView):
    def get(self, request):
        komoditas_id = request.query_params.get("komoditas_id")
        if not komoditas_id:
            return Response({"error": "komoditas_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        komoditas_id = str(komoditas_id)

        try:
            tipe_pasar = int(request.query_params.get("tipe_pasar", 1))
        except ValueError:
            return Response({"error": "tipe_pasar must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        dates = list(
            HargaPangan.objects
            .filter(pangan__master_id=komoditas_id, pangan__sumber_id=tipe_pasar, harga_sekarang__gt=0)
            .values_list("tanggal_update", flat=True)
            .distinct()
            .order_by("tanggal_update")
        )

        if not dates:
            return Response({
                "defaults": {"mode": "weekly"},
                "daily": None,
                "weekly": [],
                "monthly": [],
                "quarterly": [],
                "semesterly": [],
                "yearly": [],
            })

        weekly = set()
        monthly = set()
        quarterly = set()
        semesterly = set()
        yearly = set()

        for d in dates:
            iso_year, iso_week, _ = d.isocalendar()
            weekly.add((iso_year, iso_week))
            monthly.add((d.year, d.month))
            quarterly.add((d.year, (d.month - 1) // 3 + 1))
            semesterly.add((d.year, 1 if d.month <= 6 else 2))
            yearly.add(d.year)

        def _build_list(items, keys):
            result = []
            for item in sorted(items):
                if isinstance(item, int):
                    item = (item,)
                info = dict(zip(keys, item))
                if len(keys) == 2:
                    k1, k2 = keys
                    mode_map = {"minggu": "weekly", "bulan": "monthly", "kuartal": "quarterly", "semester": "semesterly"}
                    info["label"] = period_label(mode_map.get(k2, "yearly"), info[k1], info[k2])
                else:
                    info["label"] = period_label("yearly", item[0], item[0])
                if "minggu" in info:
                    monday, friday = _week_range(info["tahun"], info["minggu"])
                    info["start"] = monday.strftime("%d-%m-%Y")
                    info["end"] = friday.strftime("%d-%m-%Y")
                result.append(info)
            return result

        weekly_list = _build_list(weekly, ["tahun", "minggu"])
        monthly_list = _build_list(monthly, ["tahun", "bulan"])
        quarterly_list = _build_list(quarterly, ["tahun", "kuartal"])
        semesterly_list = _build_list(semesterly, ["tahun", "semester"])
        yearly_list = _build_list(yearly, ["tahun"])

        latest_week = weekly_list[-1] if weekly_list else {}
        return Response({
            "defaults": {
                "mode": "weekly",
                "tahun": latest_week.get("tahun"),
                "minggu": latest_week.get("minggu"),
            },
            "daily": {
                "start": dates[0].strftime("%d-%m-%Y"),
                "end": dates[-1].strftime("%d-%m-%Y"),
            },
            "weekly": weekly_list,
            "monthly": monthly_list,
            "quarterly": quarterly_list,
            "semesterly": semesterly_list,
            "yearly": yearly_list,
        })


# ---------------------------------------------------------------------------
# PantauHargaInitialView  —  GET /api/harga/peta/initial/
# Single request returning everything the pantau-harga page needs on first load.
# ---------------------------------------------------------------------------

class PantauHargaInitialView(APIView):
    """
    Consolidated initial-load endpoint for the Pantau Harga page.

    Replaces three sequential browser requests:
      GET /api/kabupaten/
      GET /api/komoditas/
      GET /api/harga/peta/options/?komoditas_id=X&tipe_pasar=Y
      GET /api/harga/peta/?komoditas_id=X&tipe_pasar=Y&mode=Z&...

    Query params (all optional):
      komoditas_id  — master_id; defaults to first in list
      tipe_pasar    — default 1
      mode          — weekly | monthly | quarterly | semesterly | daily; default weekly
      tahun, minggu/bulan/kuartal/semester/tanggal — default to latest available
    """

    MODES = frozenset(["daily", "weekly", "monthly", "quarterly", "semesterly", "yearly"])

    def get(self, request):
        tipe_pasar = int(request.query_params.get("tipe_pasar", 1))
        mode = request.query_params.get("mode", "weekly")
        if mode not in self.MODES:
            mode = "weekly"

        # ── Lists — run in parallel (independent queries) ─────────────────────
        with ThreadPoolExecutor(max_workers=2) as ex:
            kab_fut = ex.submit(lambda: list(WilayahKabupaten.objects.order_by("nama")))
            _sid = tipe_pasar
            kom_fut = ex.submit(lambda: list(Pangan.objects.filter(sumber_id=_sid).order_by("nama")))
            kabupaten_qs = kab_fut.result()
            komoditas_qs = kom_fut.result()

        kabupaten_data = KabupatenSerializer(kabupaten_qs, many=True).data
        komoditas_data = KomoditasSerializer(komoditas_qs, many=True).data

        # ── Resolve komoditas_id ─────────────────────────────────────────────
        raw_id   = request.query_params.get("komoditas_id")
        raw_nama = request.query_params.get("komoditas_nama")
        try:
            if raw_id:
                komoditas_id = str(raw_id)
            elif raw_nama:
                obj = next((k for k in komoditas_qs if k.nama == raw_nama), None)
                komoditas_id = obj.master_id if obj else (komoditas_qs[0].master_id if komoditas_qs else None)
            else:
                komoditas_id = komoditas_qs[0].master_id if komoditas_qs else None
        except (ValueError, TypeError):
            komoditas_id = komoditas_qs[0].master_id if komoditas_qs else None

        empty = {
            "kabupaten": kabupaten_data,
            "komoditas": komoditas_data,
            "period_options": None,
            "peta": [],
            "applied": None,
        }
        if komoditas_id is None:
            return Response(empty)

        # ── Dates — shared work for period_options + period resolution ───────
        dates = list(
            HargaPangan.objects
            .filter(pangan__master_id=komoditas_id, pangan__sumber_id=tipe_pasar, harga_sekarang__gt=0)
            .values_list("tanggal_update", flat=True)
            .distinct()
            .order_by("tanggal_update")
        )

        period_options = self._build_period_options(dates)

        if not dates:
            return Response({**empty, "period_options": period_options})

        latest = dates[-1]
        params = request.query_params

        # ── Resolve period ────────────────────────────────────────────────────
        if mode == "daily":
            tanggal_str = params.get("tanggal")
            if tanggal_str:
                try:
                    tanggal = datetime.strptime(tanggal_str, "%d-%m-%Y").date()
                except ValueError:
                    tanggal = latest
            else:
                tanggal = latest
            bounds = (tanggal, tanggal, tanggal - timedelta(days=1), tanggal - timedelta(days=1))
            daily_list = period_options.get("daily") or {}
            label = tanggal.strftime("%d %B %Y")
            applied_params = {"mode": "daily", "tanggal": tanggal.strftime("%d-%m-%Y")}
            initial_index = 0
        else:
            tahun, period_num, label, initial_index = self._resolve_period(mode, params, latest, period_options)
            if tahun is None:
                return Response({**empty, "period_options": period_options})
            bounds = resolve_period(mode, tahun, period_num)
            if bounds is None:
                return Response({**empty, "period_options": period_options})
            applied_params = {"mode": mode, "tahun": tahun}
            key_map = {"weekly": "minggu", "monthly": "bulan", "quarterly": "kuartal", "semesterly": "semester"}
            if mode in key_map:
                applied_params[key_map[mode]] = period_num

        # ── Price data — try Gold table first, fall back to raw ──────────────
        start, end, prev_start, prev_end = bounds
        peta = None
        if mode != "daily":
            pangan_obj = next(
                (k for k in komoditas_qs if k.master_id == komoditas_id and k.sumber_id == tipe_pasar), None
            )
            if pangan_obj:
                peta = _build_peta_from_snapshot(pangan_obj.pk, mode, tahun, period_num, kabupaten_qs)
        if peta is None:
            current  = _latest_price_per_kab(komoditas_id, tipe_pasar, start, end)
            previous = _latest_price_simple(komoditas_id, tipe_pasar, prev_start, prev_end)
            peta     = _build_peta_raw(kabupaten_qs, current, previous)

        # ── Applied period metadata ───────────────────────────────────────────
        komoditas_obj = next((k for k in komoditas_qs if k.master_id == komoditas_id), None)
        applied = {
            "komoditas_id":   komoditas_id,
            "komoditas_nama": komoditas_obj.nama if komoditas_obj else "",
            "mode":           mode,
            "params":         applied_params,
            "label":          label,
            "initial_index":  initial_index,
        }

        return Response({
            "kabupaten":      kabupaten_data,
            "komoditas":      komoditas_data,
            "period_options": period_options,
            "peta":           peta,
            "applied":        applied,
        })

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _build_period_options(self, dates):
        if not dates:
            return {"defaults": {"mode": "weekly"}, "daily": None, "weekly": [], "monthly": [], "quarterly": [], "semesterly": [], "yearly": []}

        weekly = set(); monthly = set(); quarterly = set(); semesterly = set(); yearly = set()
        for d in dates:
            iso_year, iso_week, _ = d.isocalendar()
            weekly.add((iso_year, iso_week))
            monthly.add((d.year, d.month))
            quarterly.add((d.year, (d.month - 1) // 3 + 1))
            semesterly.add((d.year, 1 if d.month <= 6 else 2))
            yearly.add(d.year)

        def _build_list(items, keys):
            result = []
            for item in sorted(items):
                if isinstance(item, int):
                    item = (item,)
                info = dict(zip(keys, item))
                if len(keys) == 2:
                    k1, k2 = keys
                    mode_map = {"minggu": "weekly", "bulan": "monthly", "kuartal": "quarterly", "semester": "semesterly"}
                    info["label"] = period_label(mode_map.get(k2, "yearly"), info[k1], info[k2])
                else:
                    info["label"] = period_label("yearly", item[0], item[0])
                if "minggu" in info:
                    monday, friday = _week_range(info["tahun"], info["minggu"])
                    info["start"] = monday.strftime("%d-%m-%Y")
                    info["end"]   = friday.strftime("%d-%m-%Y")
                result.append(info)
            return result

        weekly_list    = _build_list(weekly,    ["tahun", "minggu"])
        monthly_list   = _build_list(monthly,   ["tahun", "bulan"])
        quarterly_list = _build_list(quarterly, ["tahun", "kuartal"])
        semesterly_list= _build_list(semesterly,["tahun", "semester"])
        yearly_list    = _build_list(yearly,    ["tahun"])

        latest_week = weekly_list[-1] if weekly_list else {}
        return {
            "defaults": {"mode": "weekly", "tahun": latest_week.get("tahun"), "minggu": latest_week.get("minggu")},
            "daily":      {"start": dates[0].strftime("%d-%m-%Y"), "end": dates[-1].strftime("%d-%m-%Y")},
            "weekly":     weekly_list,
            "monthly":    monthly_list,
            "quarterly":  quarterly_list,
            "semesterly": semesterly_list,
            "yearly":     yearly_list,
        }

    def _resolve_period(self, mode, params, latest, period_options):
        """Returns (tahun, period_num, label, initial_index) for non-daily modes."""
        tahun_str = params.get("tahun")
        key_map = {"weekly": "minggu", "monthly": "bulan", "quarterly": "kuartal", "semesterly": "semester"}
        param_key = key_map.get(mode)

        if mode == "yearly":
            tahun = int(tahun_str) if tahun_str else latest.year
            period_num = tahun
            period_list = period_options.get("yearly", [])
            idx = next((i for i, e in enumerate(period_list) if e["tahun"] == tahun), max(0, len(period_list) - 1))
            return tahun, period_num, period_label("yearly", tahun, tahun), idx

        val_str = params.get(param_key) if param_key else None

        if tahun_str and val_str:
            tahun = int(tahun_str)
            period_num = int(val_str)
        else:
            # Default to latest available
            iso_year, iso_week, _ = latest.isocalendar()
            if mode == "weekly":
                tahun, period_num = iso_year, iso_week
            elif mode == "monthly":
                tahun, period_num = latest.year, latest.month
            elif mode == "quarterly":
                tahun, period_num = latest.year, (latest.month - 1) // 3 + 1
            elif mode == "semesterly":
                tahun, period_num = latest.year, (1 if latest.month <= 6 else 2)
            else:
                return None, None, None, None

        period_list = period_options.get(mode, [])
        idx = next(
            (i for i, e in enumerate(period_list) if e.get("tahun") == tahun and e.get(param_key) == period_num),
            max(0, len(period_list) - 1),
        )
        return tahun, period_num, period_label(mode, tahun, period_num), idx


# ---------------------------------------------------------------------------
# HargaUpdateView  —  POST /api/harga/update/
# ---------------------------------------------------------------------------

class HargaUpdateView(APIView):
    MODES = frozenset(["daily", "weekly", "monthly", "quarterly", "semesterly", "yearly"])

    def get(self, request):
        mode = request.query_params.get("mode")
        if mode and mode in self.MODES:
            return self._handle_mode(request, mode)
        return self._handle_legacy(request)

    # ---- legacy mode (start_date / end_date) ----

    def _handle_legacy(self, request):
        req = HargaUpdateRequestSerializer(data=request.query_params)
        if not req.is_valid():
            return Response(req.errors, status=status.HTTP_400_BAD_REQUEST)

        data = req.validated_data
        kode_kab = data["kabupaten"]
        try:
            kab = WilayahKabupaten.objects.get(kode_kabupaten=kode_kab)
        except WilayahKabupaten.DoesNotExist:
            return Response(
                {"kabupaten": f"Kabupaten with kode '{kode_kab}' not found."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = (
            HargaPangan.objects
            .filter(
                tanggal_update__range=(data["start_date"], data["end_date"]),
                kabupaten=kab,
                pangan__sumber_id=data["tipe_pasar"],
                harga_sekarang__gt=0,
            )
            .select_related("pangan")
            .order_by("tanggal_update", "pangan__nama")
        )

        total_komoditas = Pangan.objects.filter(sumber_id=data["tipe_pasar"]).count()
        komoditas_with_data = qs.values("pangan_id").distinct().count()

        if komoditas_with_data == 0:
            enum_status = "empty"
        elif komoditas_with_data == total_komoditas:
            enum_status = "full"
        else:
            enum_status = "partial"

        grouped: dict[str, list] = defaultdict(list)
        for row in qs:
            date_key = row.tanggal_update.strftime("%d-%m-%Y")
            harga = float(row.harga_sekarang)
            harga_terakhir = float(row.harga_terakhir) if row.harga_terakhir is not None else None
            if harga_terakhir is not None and harga_terakhir != 0:
                change_pct = round((harga - harga_terakhir) / harga_terakhir * 100, 2)
            else:
                change_pct = None
            grouped[date_key].append({
                "id": row.pangan.master_id,
                "nama": row.pangan.nama,
                "satuan": row.pangan.satuan,
                "harga": harga,
                "harga_terakhir": harga_terakhir,
                "change_pct": change_pct,
                "is_up": row.is_up,
            })

        return Response({
            "status": enum_status,
            "kabupaten": {"kode": kab.kode_kabupaten, "nama": kab.nama},
            "data": dict(grouped),
        })

    # ---- time-period mode ----

    def _handle_mode(self, request, mode):
        kode_kab = request.query_params.get("kabupaten")
        if not kode_kab:
            return Response({"error": "kabupaten is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tipe_pasar = int(request.query_params.get("tipe_pasar", 1))
        except (ValueError, TypeError):
            return Response({"error": "tipe_pasar must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            kab = WilayahKabupaten.objects.get(kode_kabupaten=kode_kab)
        except WilayahKabupaten.DoesNotExist:
            return Response(
                {"kabupaten": f"Kabupaten with kode '{kode_kab}' not found."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if mode == "daily":
            tanggal_str = request.query_params.get("tanggal")
            if not tanggal_str:
                return Response({"error": "tanggal is required for daily mode"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                tanggal = datetime.strptime(tanggal_str, "%d-%m-%Y").date()
            except ValueError:
                return Response({"error": "tanggal must be in DD-MM-YYYY format"}, status=status.HTTP_400_BAD_REQUEST)
            start = end = tanggal
            prd = {"tanggal": tanggal_str}
        else:
            tahun_str = request.query_params.get("tahun")
            if not tahun_str:
                return Response({"error": "tahun is required"}, status=status.HTTP_400_BAD_REQUEST)
            try:
                tahun = int(tahun_str)
            except ValueError:
                return Response({"error": "tahun must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

            period_param = {"weekly": "minggu", "monthly": "bulan", "quarterly": "kuartal", "semesterly": "semester"}.get(mode)
            if mode == "yearly":
                period_num = tahun
            else:
                if not period_param:
                    return Response({"error": f"Unknown mode '{mode}'"}, status=status.HTTP_400_BAD_REQUEST)
                val = request.query_params.get(period_param)
                if not val:
                    return Response({"error": f"{period_param} is required for {mode} mode"}, status=status.HTTP_400_BAD_REQUEST)
                try:
                    period_num = int(val)
                except ValueError:
                    return Response({"error": f"{period_param} must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

            start, end, _, _ = resolve_period(mode, tahun, period_num)
            prd = period_info(mode, tahun, period_num)

        qs = (
            HargaPangan.objects
            .filter(
                tanggal_update__gte=start,
                tanggal_update__lte=end,
                kabupaten=kab,
                pangan__sumber_id=tipe_pasar,
                harga_sekarang__gt=0,
            )
            .select_related("pangan")
            .order_by("pangan__nama", "-tanggal_update")
        )

        latest_per_komoditas = {}
        for row in qs:
            pid = row.pangan_id
            if pid not in latest_per_komoditas:
                harga = float(row.harga_sekarang)
                harga_terakhir = float(row.harga_terakhir) if row.harga_terakhir is not None else None
                if harga_terakhir is not None and harga_terakhir != 0:
                    change_pct = round((harga - harga_terakhir) / harga_terakhir * 100, 2)
                else:
                    change_pct = None
                latest_per_komoditas[pid] = {
                    "id": row.pangan.master_id,
                    "nama": row.pangan.nama,
                    "satuan": row.pangan.satuan,
                    "harga": harga,
                    "harga_terakhir": harga_terakhir,
                    "change_pct": change_pct,
                    "is_up": row.is_up,
                    "tanggal": row.tanggal_update.strftime("%d-%m-%Y"),
                }

        total_komoditas = Pangan.objects.filter(sumber_id=tipe_pasar).count()
        data_list = list(latest_per_komoditas.values())
        if len(data_list) == 0:
            enum_status = "empty"
        elif len(data_list) == total_komoditas:
            enum_status = "full"
        else:
            enum_status = "partial"

        return Response({
            "status": enum_status,
            "kabupaten": {"kode": kab.kode_kabupaten, "nama": kab.nama},
            "mode": mode,
            "period": prd,
            "data": data_list,
        })


# ---------------------------------------------------------------------------
# HargaSnapshotListView  —  GET /api/harga/snapshot/
# ---------------------------------------------------------------------------

class HargaSnapshotListView(generics.ListAPIView):
    serializer_class = HargaSnapshotSerializer

    VALID_TIPES = frozenset(["weekly", "monthly", "quarterly", "semesterly"])

    def get_queryset(self):
        params = self.request.query_params
        kabupaten = params.get("kabupaten")
        komoditas_id = params.get("komoditas_id")
        tipe = params.get("tipe")

        if not kabupaten or not komoditas_id or not tipe:
            return HargaSnapshot.objects.none()
        if tipe not in self.VALID_TIPES:
            return HargaSnapshot.objects.none()

        try:
            tipe_pasar = int(params.get("tipe_pasar", 1))
        except (ValueError, TypeError):
            return HargaSnapshot.objects.none()

        qs = (
            HargaSnapshot.objects
            .filter(
                kabupaten__kode_kabupaten=kabupaten,
                pangan__master_id=komoditas_id,
                pangan__sumber_id=tipe_pasar,
                pasar__isnull=True,
                periode_tipe=tipe,
            )
            .select_related("pangan", "kabupaten")
            .order_by("periode_tahun", "periode_nomor")
        )

        tahun = params.get("tahun")
        if tahun:
            try:
                qs = qs.filter(periode_tahun=int(tahun))
            except ValueError:
                pass

        return qs


# ---------------------------------------------------------------------------
# HargaSnapshotWideView  —  GET /api/harga/snapshot/wide/
# ---------------------------------------------------------------------------

class HargaSnapshotWideView(APIView):
    VALID_TIPES = frozenset(["weekly", "monthly", "quarterly", "semesterly"])

    def get(self, request):
        params = request.query_params
        kabupaten = params.get("kabupaten")
        tipe = params.get("tipe")

        if not kabupaten:
            return Response({"error": "kabupaten is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not tipe or tipe not in self.VALID_TIPES:
            return Response(
                {"error": f"tipe must be one of: {', '.join(sorted(self.VALID_TIPES))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            tipe_pasar = int(params.get("tipe_pasar", 1))
        except (ValueError, TypeError):
            return Response({"error": "tipe_pasar must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        tahun = None
        tahun_str = params.get("tahun")
        if tahun_str:
            try:
                tahun = int(tahun_str)
            except ValueError:
                return Response({"error": "tahun must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        df = build_wide_dataframe(
            kabupaten_kode=kabupaten,
            periode_tipe=tipe,
            periode_tahun=tahun,
            sumber_id=tipe_pasar,
        )

        if df.empty:
            return Response([])

        df["periode_start"] = df["periode_start"].astype(str)
        df["periode_end"]   = df["periode_end"].astype(str)
        records = df.where(df.notna(), other=None).to_dict(orient="records")
        return Response(records)


# ---------------------------------------------------------------------------
# HargaPrediksiView  —  GET /api/harga/prediksi/
# ---------------------------------------------------------------------------

class HargaPrediksiView(APIView):
    VALID_TIPES = frozenset(["weekly", "monthly", "quarterly", "semesterly"])

    def get(self, request):
        params = request.query_params
        komoditas_id_str = params.get("komoditas_id")
        kabupaten = params.get("kabupaten")

        if not komoditas_id_str:
            return Response({"error": "komoditas_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not kabupaten:
            return Response({"error": "kabupaten is required"}, status=status.HTTP_400_BAD_REQUEST)

        komoditas_id = str(komoditas_id_str)

        tipe = params.get("tipe", "weekly")
        if tipe not in self.VALID_TIPES:
            return Response(
                {"error": f"tipe must be one of: {', '.join(sorted(self.VALID_TIPES))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            horizon = int(params.get("horizon", 4))
            if not 1 <= horizon <= 6:
                raise ValueError
        except (ValueError, TypeError):
            return Response({"error": "horizon must be an integer between 1 and 6"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tipe_pasar = int(params.get("tipe_pasar", 1))
        except (ValueError, TypeError):
            return Response({"error": "tipe_pasar must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            result = prediksi_predict(
                pangan_id=komoditas_id,
                kabupaten_kode=kabupaten,
                periode_tipe=tipe,
                horizon=horizon,
                sumber_id=tipe_pasar,
            )
        except ModelNotAvailable as exc:
            return Response(
                {"error": "model_not_available", "detail": str(exc)},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = PrediksiResultSerializer(result)
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# PasarListView  —  GET /api/harga/pasar/
# ---------------------------------------------------------------------------

class PasarListView(generics.ListAPIView):
    serializer_class = PasarSerializer

    def get_queryset(self):
        qs = WilayahPasar.objects.select_related("kabupaten").order_by("nama")
        kabupaten = self.request.query_params.get("kabupaten")
        if kabupaten:
            qs = qs.filter(kabupaten__kode_kabupaten=kabupaten)
        tipe_pasar = self.request.query_params.get("tipe_pasar")
        if tipe_pasar is not None:
            try:
                qs = qs.filter(tipe_pasar=int(tipe_pasar))
            except ValueError:
                pass
        return qs


# ---------------------------------------------------------------------------
# WholesaleSideBySideView  —  GET /api/harga/wholesale/side-by-side/
# ---------------------------------------------------------------------------

class WholesaleSideBySideView(APIView):
    PERIOD_TIPES = frozenset(["daily", "weekly", "monthly"])

    def get(self, request):
        params = request.query_params
        komoditas_slug = params.get("komoditas_slug")
        kabupaten = params.get("kabupaten")
        if not komoditas_slug or not kabupaten:
            return Response(
                {"error": "komoditas_slug and kabupaten are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tipe = params.get("tipe", "weekly")
        if tipe not in self.PERIOD_TIPES:
            return Response(
                {"error": f"tipe must be one of: {', '.join(sorted(self.PERIOD_TIPES))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            pangan = Pangan.objects.get(slug=komoditas_slug, sumber_id=3)
        except Pangan.DoesNotExist:
            return Response({"error": f"Commodity '{komoditas_slug}' not found"}, status=status.HTTP_404_NOT_FOUND)

        market_ids_str = params.get("markets")
        pasar_qs = WilayahPasar.objects.filter(kabupaten__kode_kabupaten=kabupaten,tipe_pasar=3)
        if market_ids_str:
            try:
                ids = [int(x.strip()) for x in market_ids_str.split(",")]
                pasar_qs = pasar_qs.filter(market_id__in=ids)
            except ValueError:
                return Response({"error": "markets must be comma-separated integers"}, status=status.HTTP_400_BAD_REQUEST)

        start_date_str = params.get("start_date")
        end_date_str = params.get("end_date")

        if tipe == "daily":
            return self._daily_response(pangan, pasar_qs, kabupaten, start_date_str, end_date_str)
        return self._aggregated_response(pangan, pasar_qs, kabupaten, tipe, start_date_str, end_date_str)

    def _daily_response(self, pangan, pasar_qs, kabupaten, start_date_str, end_date_str):
        # Daily wholesale regency data lives in HargaPangan (sumber_id=3),
        # same source the Gold table is built from — HargaPanganWholesaleMarket is per-market only.
        base_qs = HargaPangan.objects.filter(
            pangan=pangan,
            kabupaten__kode_kabupaten=kabupaten,
            harga_sekarang__gt=0,
        )

        end = self._parse_date(end_date_str) if end_date_str else (
            base_qs.aggregate(Max("tanggal_update"))["tanggal_update__max"]
        )
        empty = {
            "komoditas": {"slug": pangan.slug, "nama": pangan.nama},
            "kabupaten": {"kode": kabupaten},
            "regency_avg": [],
            "markets": [],
        }
        if end is None:
            return Response(empty)

        rows = list(
            base_qs
            .filter(tanggal_update__lte=end)
            .order_by("-tanggal_update")
            .values("tanggal_update", "harga_sekarang")[:48]
        )
        if not rows:
            return Response(empty)

        regency_avg = [
            {"date": str(r["tanggal_update"]), "harga": float(r["harga_sekarang"])}
            for r in reversed(rows)
        ]

        return Response({
            "komoditas": {"slug": pangan.slug, "nama": pangan.nama},
            "kabupaten": {"kode": kabupaten},
            "regency_avg": regency_avg,
            "markets": [],
        })

    def _aggregated_response(self, pangan, pasar_qs, kabupaten, tipe, start_date_str, end_date_str):
        if tipe not in ("weekly", "monthly"):
            return Response({"error": f"unsupported tipe: {tipe}"}, status=status.HTTP_400_BAD_REQUEST)

        # regency_avg comes from HargaSnapshot (Gold table, pre-computed LPIT aggregates).
        # HargaPanganWholesaleMarket (per-market bronze rows) is not used here — the
        # frontend no longer renders per-market series, so returning markets=[] is correct.
        qs = HargaSnapshot.objects.filter(
            pangan=pangan,
            kabupaten__kode_kabupaten=kabupaten,
            pasar__isnull=True,
            periode_tipe=tipe,
        ).order_by("periode_tahun", "periode_nomor")

        if start_date_str:
            start = self._parse_date(start_date_str)
            qs = qs.filter(periode_end__gte=start)
        if end_date_str:
            end = self._parse_date(end_date_str)
            qs = qs.filter(periode_start__lte=end)

        regency_avg = [
            {
                "periode_start": str(row["periode_start"]),
                "periode_end":   str(row["periode_end"]),
                "periode_tahun": row["periode_tahun"],
                "periode_nomor": row["periode_nomor"],
                "harga":         float(row["harga_lkv"]),
            }
            for row in qs.values(
                "periode_start", "periode_end",
                "periode_tahun", "periode_nomor", "harga_lkv",
            )
        ]

        return Response({
            "komoditas": {"slug": pangan.slug, "nama": pangan.nama},
            "kabupaten": {"kode": kabupaten},
            "regency_avg": regency_avg,
            "markets": [],
        })

    @staticmethod
    def _parse_date(s: str):
        from datetime import datetime
        return datetime.strptime(s, "%d-%m-%Y").date()


# ---------------------------------------------------------------------------
# AnalisisSnapshotView  —  GET /api/harga/analisis/snapshot/
# ---------------------------------------------------------------------------

class AnalisisSnapshotView(APIView):
    """
    Returns pasar-modern (sumber_id=2) and wholesale-regency (sumber_id=3) Gold
    table time-series for one commodity stream identified by slug.

    Params:
      slug       (required) — commodity slug, consistent across both PIHPS sumber_ids
      kabupaten  (required) — kode_kabupaten
      tipe       (required) — weekly | monthly | quarterly | semesterly
      tahun      (optional) — filter to a single year
    """

    VALID_TIPES = frozenset(["weekly", "monthly", "quarterly", "semesterly"])

    def get(self, request):
        params = request.query_params
        slug = params.get("slug")
        kabupaten = params.get("kabupaten")
        tipe = params.get("tipe")

        if not slug or not kabupaten:
            return Response({"error": "slug and kabupaten are required"}, status=status.HTTP_400_BAD_REQUEST)
        if not tipe or tipe not in self.VALID_TIPES:
            return Response(
                {"error": f"tipe must be one of: {', '.join(sorted(self.VALID_TIPES))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tahun = None
        tahun_str = params.get("tahun")
        if tahun_str:
            try:
                tahun = int(tahun_str)
            except ValueError:
                return Response({"error": "tahun must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        pangan_map = {
            p.sumber_id: p
            for p in Pangan.objects.filter(slug=slug, sumber_id__in=[2, 3])
        }

        if not pangan_map:
            return Response(
                {"error": f"No PIHPS commodity found with slug='{slug}'"},
                status=status.HTTP_404_NOT_FOUND,
            )

        result = {}
        if 2 in pangan_map:
            result["pasar_modern"] = self._get_series(pangan_map[2], kabupaten, tipe, tahun)
        if 3 in pangan_map:
            result["wholesale_regency"] = self._get_series(pangan_map[3], kabupaten, tipe, tahun)

        return Response(result)

    def _get_series(self, pangan, kabupaten_kode, tipe, tahun):
        qs = (
            HargaSnapshot.objects
            .filter(
                pangan=pangan,
                kabupaten__kode_kabupaten=kabupaten_kode,
                pasar__isnull=True,
                periode_tipe=tipe,
            )
            .order_by("periode_tahun", "periode_nomor")
            .values(
                "periode_start", "periode_end", "periode_tahun", "periode_nomor",
                "harga_lkv", "change_pct", "is_locf", "is_up",
            )
        )
        if tahun:
            qs = qs.filter(periode_tahun=tahun)

        return [
            {
                "periode_start": str(s["periode_start"]),
                "periode_end":   str(s["periode_end"]),
                "periode_tahun": s["periode_tahun"],
                "periode_nomor": s["periode_nomor"],
                "harga":         float(s["harga_lkv"]),
                "change_pct":    round(float(s["change_pct"]), 4) if s["change_pct"] is not None else None,
                "is_locf":       s["is_locf"],
                "is_up":         s["is_up"],
            }
            for s in qs
        ]


# ---------------------------------------------------------------------------
# PrediksiReconciliationView  —  GET /api/harga/prediksi/reconciliation/
# ---------------------------------------------------------------------------

class PrediksiReconciliationView(APIView):
    """
    Returns reconciled (predicted vs. actual) prediction logs for a given
    commodity stream. Only rows where actual data has been filled in by the
    reconcile_predictions management command are included.

    Params:
      komoditas_id  (required)
      kabupaten     (required)
      tipe          (optional, default: weekly)
    """

    def get(self, request):
        params = request.query_params
        komoditas_id = params.get("komoditas_id")
        kabupaten = params.get("kabupaten")
        tipe = params.get("tipe", "weekly")

        if not komoditas_id or not kabupaten:
            return Response(
                {"error": "komoditas_id and kabupaten are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from sistem.models import PredictionLog, PrediksiArtifact

        qs = (
            PredictionLog.objects
            .filter(
                is_reconciled=True,
                artifact__pangan__master_id=str(komoditas_id),
                artifact__kabupaten__kode_kabupaten=kabupaten,
                artifact__periode_tipe=tipe,
            )
            .select_related("artifact__pangan", "artifact__kabupaten")
            .order_by("periode_tahun", "periode_nomor", "horizon")
        )

        return Response([
            {
                "horizon": pl.horizon,
                "periode_start": str(pl.periode_start),
                "periode_end": str(pl.periode_end),
                "periode_tahun": pl.periode_tahun,
                "periode_nomor": pl.periode_nomor,
                "predicted_harga": float(pl.predicted_harga_lkv),
                "actual_harga": float(pl.actual_harga_lkv),
                "predicted_change_pct": float(pl.predicted_change_pct),
                "actual_change_pct": float(pl.actual_change_pct) if pl.actual_change_pct else None,
                "abs_error_pct": (
                    round(abs(float(pl.actual_harga_lkv) - float(pl.predicted_harga_lkv))
                          / float(pl.actual_harga_lkv) * 100, 4)
                    if pl.actual_harga_lkv else None
                ),
            }
            for pl in qs
        ])


# ---------------------------------------------------------------------------
# ModelFoldEvaluationView  —  GET /api/harga/prediksi/evaluation/
# ---------------------------------------------------------------------------

class ModelFoldEvaluationView(APIView):
    """
    Returns per-row walk-forward evaluation results (predicted vs actual) from
    ModelFoldEvaluation. Enables Opsi A — rekonstruksi perbandingan dari data
    historis yang sudah ada.

    Params:
      komoditas_id  (required)
      kabupaten     (required)
      tipe          (optional, default: weekly)
      horizon       (optional, default: all horizons)
    """

    def get(self, request):
        params = request.query_params
        komoditas_id = params.get("komoditas_id")
        kabupaten = params.get("kabupaten")
        tipe = params.get("tipe", "weekly")
        horizon_str = params.get("horizon")

        if not komoditas_id or not kabupaten:
            return Response(
                {"error": "komoditas_id and kabupaten are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from sistem.models import ModelFoldEvaluation, Pangan, PrediksiArtifact

        stream = (
            PrediksiArtifact.objects
            .filter(
                pangan__master_id=str(komoditas_id),
                pangan__sumber_id=1,
                kabupaten__kode_kabupaten=kabupaten,
                periode_tipe=tipe,
                is_available=True,
            )
            .select_related("pangan", "kabupaten")
            .first()
        )
        if stream is None:
            return Response(
                {"error": "model_not_available",
                 "detail": f"No trained model for komoditas={komoditas_id}, kabupaten={kabupaten}, tipe={tipe}"},
                status=status.HTTP_404_NOT_FOUND,
            )

        qs = ModelFoldEvaluation.objects.filter(artifact=stream)

        if horizon_str:
            try:
                qs = qs.filter(horizon=int(horizon_str))
            except (ValueError, TypeError):
                return Response({"error": "horizon must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        qs = qs.order_by("horizon", "fold", "periode_tahun", "periode_nomor")

        evaluations = [
            {
                "horizon": ev.horizon,
                "fold": ev.fold,
                "periode_start": str(ev.periode_start),
                "periode_end": str(ev.periode_end),
                "predicted_harga_lkv": ev.predicted_harga_lkv,
                "actual_harga_lkv": ev.actual_harga_lkv,
                "predicted_log_return": ev.predicted_log_return,
                "actual_log_return": ev.actual_log_return,
                "abs_pct_error": round(ev.abs_pct_error, 4),
            }
            for ev in qs
        ]

        return Response({
            "komoditas": {
                "id": stream.pangan.master_id,
                "nama": stream.pangan.nama,
            },
            "kabupaten": {
                "kode": stream.kabupaten.kode_kabupaten,
                "nama": stream.kabupaten.nama,
            },
            "periode_tipe": tipe,
            "aggregates": {
                "eval_mae_h1": float(stream.eval_mae_h1) if stream.eval_mae_h1 else None,
                "eval_mae_h4": float(stream.eval_mae_h4) if stream.eval_mae_h4 else None,
                "eval_mape_h1": float(stream.eval_mape_h1) if stream.eval_mape_h1 else None,
                "eval_mape_h4": float(stream.eval_mape_h4) if stream.eval_mape_h4 else None,
                "eval_rmse_h1": float(stream.eval_rmse_h1) if stream.eval_rmse_h1 else None,
                "eval_rmse_h4": float(stream.eval_rmse_h4) if stream.eval_rmse_h4 else None,
            },
            "evaluations": evaluations,
        })
