"""
Blackbox test for the ETL seed command.

Covers test scenario:
  13 — Eksekusi terjadwal: seed_harga_harian membaca CSV dan menyimpan
       HargaPangan dengan benar.
"""

from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase

from sistem.models import HargaPangan, Pangan, WilayahKabupaten

PROJECT_ROOT = Path(__file__).resolve().parents[2]
HARGA_HARIAN_DIR = PROJECT_ROOT / "raw_data" / "harga_harian"


class SeedHargaHarianTest(TestCase):
    """Test 13: seed_harga_harian command dengan temporary CSV."""

    CSV_FILENAME = "test_comodity_harga_harian.csv"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.csv_path = HARGA_HARIAN_DIR / cls.CSV_FILENAME

    def setUp(self):
        self.kab = WilayahKabupaten.objects.create(
            kode_kabupaten="7777", nama="Kab Test",
            lat=0.0, long=0.0, koordinat="{}",
        )
        self.pangan = Pangan.objects.create(
            nama="Test Comodity",  # must match _filename_to_nama output
            master_id="777",
            sumber_id=1,
            satuan="kg",
            slug="test_comodity",
        )
        # Write temp CSV
        content = (
            "date,kabupaten_kota,harga\n"
            "2024-01-01,7777,15000\n"
            "2024-01-02,7777,15500\n"
            "2024-01-03,7777,15200\n"
        )
        self.csv_path.write_text(content)

    def tearDown(self):
        if self.csv_path.exists():
            self.csv_path.unlink()

    def test_seed_creates_harga_pangan_rows(self):
        """seed_harga_harian → HargaPangan bertambah sesuai data CSV."""
        out = StringIO()
        call_command("seed_harga_harian", stdout=out)
        output = out.getvalue()

        self.assertIn("Seed complete", output)
        self.assertIn("3 created", output)

        rows = HargaPangan.objects.filter(pangan=self.pangan, kabupaten=self.kab)
        self.assertEqual(rows.count(), 3)

    def test_seed_skips_zero_harga(self):
        """Baris dengan harga 0 atau kosong tidak dimasukkan."""
        # Append a zero-price row to the CSV
        with self.csv_path.open("a") as f:
            f.write("2024-01-04,7777,0\n")

        out = StringIO()
        call_command("seed_harga_harian", stdout=out)
        rows = HargaPangan.objects.filter(pangan=self.pangan, kabupaten=self.kab)
        # Only the 3 original rows; the zero-price row is skipped
        self.assertEqual(rows.count(), 3)

    def test_seed_skips_unknown_kabupaten(self):
        """Baris dengan kode kabupaten tidak dikenal di-skip."""
        unknown_csv = HARGA_HARIAN_DIR / "test_unknown_kab_harga_harian.csv"
        unknown_pangan = Pangan.objects.create(
            nama="Test Unknown Kab", master_id="778", sumber_id=1,
            satuan="kg", slug="test_unknown_kab",
        )
        content = (
            "date,kabupaten_kota,harga\n"
            "2024-01-01,99999,20000\n"
        )
        unknown_csv.write_text(content)
        try:
            out = StringIO()
            call_command("seed_harga_harian", stdout=out)
            rows = HargaPangan.objects.filter(pangan=unknown_pangan)
            self.assertEqual(rows.count(), 0)
        finally:
            unknown_csv.unlink()

    def test_seed_is_up_computed_correctly(self):
        """Flag is_up: harga naik → True, turun → False."""
        out = StringIO()
        call_command("seed_harga_harian", stdout=out)

        rows = HargaPangan.objects.filter(
            pangan=self.pangan, kabupaten=self.kab
        ).order_by("tanggal_update")
        self.assertEqual(rows[0].is_up, None)   # first entry, no previous
        self.assertEqual(rows[1].is_up, True)    # 15500 > 15000
        self.assertEqual(rows[2].is_up, False)   # 15200 < 15500
