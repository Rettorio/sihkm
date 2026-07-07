"""
Blackbox tests for the LPIT aggregation engine.

Covers test scenarios:
  14 — LOCF gap handling (is_locf flag)
  15 — Weekly aggregation (correct LKV computation)
"""

from datetime import date, timedelta
from decimal import Decimal
from io import StringIO

from django.test import TestCase

from sistem.models import HargaPangan, Pangan, WilayahKabupaten
from sistem.services.aggregator import (
    LPITAggregator,
    WeeklyStrategy,
    _lkv_for_bucket,
    _month_range,
    _week_range,
)


# ===========================================================================
# Test 14 — LOCF (Last Observation Carried Forward)
# ===========================================================================

class LOCFTests(TestCase):
    """Test 14: Penanganan data kosong — gap harga → is_locf=True."""

    def setUp(self):
        self.kab = WilayahKabupaten.objects.create(
            kode_kabupaten="9999", nama="Kab Test",
            lat=0.0, long=0.0, koordinat="{}",
        )
        self.pangan = Pangan.objects.create(
            nama="Test Comodity", master_id="999", sumber_id=1, satuan="kg",
        )

    def test_lkv_returns_none_when_no_data(self):
        """Tidak ada HargaPangan → _lkv_for_bucket returns None."""
        row = _lkv_for_bucket(self.pangan.id, "9999", date(2024, 6, 1))
        self.assertIsNone(row)

    def test_lkv_excludes_zero_harga(self):
        """harga_sekarang=0 di-skip (SP2KP sends 0 for holidays)."""
        HargaPangan.objects.create(
            pangan=self.pangan, tanggal_update=date(2024, 5, 20),
            harga_sekarang=Decimal("0"), kabupaten=self.kab,
        )
        row = _lkv_for_bucket(self.pangan.id, "9999", date(2024, 6, 1))
        self.assertIsNone(row)

    def test_lkv_finds_latest_before_bucket_end(self):
        """Dari multiple row, ambil max(tanggal_update) <= bucket_end."""
        HargaPangan.objects.create(
            pangan=self.pangan, tanggal_update=date(2024, 5, 15),
            harga_sekarang=Decimal("10000"), kabupaten=self.kab,
        )
        HargaPangan.objects.create(
            pangan=self.pangan, tanggal_update=date(2024, 5, 20),
            harga_sekarang=Decimal("12000"), kabupaten=self.kab,
        )
        row = _lkv_for_bucket(self.pangan.id, "9999", date(2024, 6, 1))
        self.assertIsNotNone(row)
        self.assertEqual(row.harga_sekarang, Decimal("12000"))

    def test_lkv_ignores_row_after_bucket_end(self):
        """Row dengan tanggal_update > bucket_end tidak diambil."""
        HargaPangan.objects.create(
            pangan=self.pangan, tanggal_update=date(2024, 7, 1),
            harga_sekarang=Decimal("50000"), kabupaten=self.kab,
        )
        row = _lkv_for_bucket(self.pangan.id, "9999", date(2024, 6, 30))
        self.assertIsNone(row)

    def test_aggregate_sets_locf_flag_on_gap_week(self):
        """Bucket tanpa data → is_locf=True ketika ada seed snapshot prev."""
        from sistem.models import HargaSnapshot

        agg = LPITAggregator()
        strategy = WeeklyStrategy()

        # Create a seed snapshot representing the end of the previous year
        seed_snap = HargaSnapshot(
            pangan=self.pangan, kabupaten=self.kab, pasar=None,
            periode_tipe="weekly", periode_tahun=2024,
            periode_nomor=21, periode_start=date(2024, 5, 20),
            periode_end=date(2024, 5, 24),
            harga_lkv=Decimal("10000"),
            tanggal_lkv=date(2024, 5, 24),
            is_locf=False,
        )

        # Buckets for weeks 22-23 (no HargaPangan data exists at all)
        w22_start, w22_end = _week_range(2024, 22)
        w23_start, w23_end = _week_range(2024, 23)
        buckets = strategy.buckets_in_range(w22_start, w23_end)
        snaps = agg.aggregate_stream(
            self.pangan, self.kab, strategy, buckets,
            seed_snapshot=seed_snap,
        )

        self.assertEqual(len(snaps), 2)
        # Week 22 has no data but prev_price from seed → is_locf=True
        self.assertTrue(snaps[0].is_locf)
        self.assertEqual(snaps[0].harga_lkv, Decimal("10000"))  # carried forward
        self.assertEqual(snaps[0].harga_lkv_prev, Decimal("10000"))


# ===========================================================================
# Test 15 — Weekly / Monthly aggregation
# ===========================================================================

class PeriodBoundaryTests(TestCase):
    """Test 15: Fungsi batas periode mingguan & bulanan."""

    def test_week_range_2024_week1(self):
        """Week 1 2024: Monday Jan 1 – Friday Jan 5."""
        start, end = _week_range(2024, 1)
        self.assertEqual(start, date(2024, 1, 1))
        self.assertEqual(end, date(2024, 1, 5))

    def test_week_range_2025_week1(self):
        """Week 1 2025: Monday Dec 30 2024 – Friday Jan 3 2025."""
        start, end = _week_range(2025, 1)
        self.assertEqual(start, date(2024, 12, 30))
        self.assertEqual(end, date(2025, 1, 3))

    def test_month_range_feb_2024_leap(self):
        """Februari 2024 (leap) → 1–29."""
        start, end = _month_range(2024, 2)
        self.assertEqual(start, date(2024, 2, 1))
        self.assertEqual(end, date(2024, 2, 29))

    def test_month_range_feb_2025_nonleap(self):
        """Februari 2025 → 1–28."""
        start, end = _month_range(2025, 2)
        self.assertEqual(start, date(2025, 2, 1))
        self.assertEqual(end, date(2025, 2, 28))


class AggregationWeeklyLVKTests(TestCase):
    """Test 15: LKV mingguan dari data harian."""

    def setUp(self):
        self.kab = WilayahKabupaten.objects.create(
            kode_kabupaten="9999", nama="Kab Test",
            lat=0.0, long=0.0, koordinat="{}",
        )
        self.pangan = Pangan.objects.create(
            nama="Test Comodity", master_id="999", sumber_id=1, satuan="kg",
        )

    def test_weekly_lkv_equals_friday_price(self):
        """5 hari kerja → harga_lkv = harga Jumat (hari terakhir)."""
        monday = date(2024, 1, 1)
        for i in range(5):
            HargaPangan.objects.create(
                pangan=self.pangan, tanggal_update=monday + timedelta(days=i),
                harga_sekarang=Decimal(10000 + i * 500), kabupaten=self.kab,
            )
        agg = LPITAggregator()
        strategy = WeeklyStrategy()
        buckets = strategy.buckets_in_range(monday, monday + timedelta(days=4))
        snaps = agg.aggregate_stream(self.pangan, self.kab, strategy, buckets)

        self.assertEqual(len(snaps), 1)
        self.assertEqual(snaps[0].harga_lkv, Decimal("12000"))
        self.assertFalse(snaps[0].is_locf)

    def test_weekly_lkv_reuses_last_price_across_weeks(self):
        """Dua minggu berurutan: LKV minggu-2 adalah harga hari Jumat minggu ke-2."""
        for w in range(1, 3):
            w_start, w_end = _week_range(2024, w)
            for i in range(5):
                HargaPangan.objects.create(
                    pangan=self.pangan,
                    tanggal_update=w_start + timedelta(days=i),
                    harga_sekarang=Decimal(10000 + ((w - 1) * 2000) + (i * 500)),
                    kabupaten=self.kab,
                )

        agg = LPITAggregator()
        strategy = WeeklyStrategy()
        _, w2_end = _week_range(2024, 2)
        _, w1_start = _week_range(2024, 1)
        buckets = strategy.buckets_in_range(w1_start, w2_end)
        snaps = agg.aggregate_stream(self.pangan, self.kab, strategy, buckets)

        self.assertEqual(len(snaps), 2)
        # Week 1 Friday: 10000 + 0*2000 + 4*500 = 12000
        # Week 2 Friday: 10000 + 1*2000 + 4*500 = 14000
        self.assertEqual(snaps[1].harga_lkv, Decimal("14000"))
        self.assertEqual(snaps[0].harga_lkv, Decimal("12000"))

    def test_change_pct_computed_correctly(self):
        """Perubahan persentase antar minggu dihitung benar."""
        # Week 1: stable at 10000
        w1_start, w1_end = _week_range(2024, 1)
        HargaPangan.objects.create(
            pangan=self.pangan, tanggal_update=w1_end,
            harga_sekarang=Decimal("10000"), kabupaten=self.kab,
        )
        # Week 2: stable at 11000 → +10%
        w2_start, w2_end = _week_range(2024, 2)
        HargaPangan.objects.create(
            pangan=self.pangan, tanggal_update=w2_end,
            harga_sekarang=Decimal("11000"), kabupaten=self.kab,
        )

        agg = LPITAggregator()
        strategy = WeeklyStrategy()
        buckets = strategy.buckets_in_range(w1_start, w2_end)
        snaps = agg.aggregate_stream(self.pangan, self.kab, strategy, buckets)

        self.assertEqual(len(snaps), 2)
        self.assertEqual(snaps[1].change_pct, Decimal("10.0000"))
        self.assertTrue(snaps[1].is_up)
